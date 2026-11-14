package app.shkriuss.feature.water

import app.shkriuss.feature.water.data.GoalEntity

/**
 * The goal of a day, and what a change of the goal writes
 * (docs/apps/water/spec.md, "The goal of a day").
 *
 * The goal that counts for a day is the goal that is not deleted, whose
 * `fromDay` is that day or earlier, with the latest `fromDay`. Of two with
 * the same `fromDay`, the one with the later `updatedAt` counts. With none,
 * the goal is 2,000 ml.
 *
 * Two goals with the same `fromDay` and the same `updatedAt` can only come
 * from a restore or, later, from sync. The spec leaves that tie to step 5.1
 * (its "Open", item 7). Until then the larger `id` counts, so every
 * screen and every reminder agree.
 */
object GoalRules {
    /** The goal with no goal record. */
    const val DEFAULT_GOAL_ML: Int = 2_000

    /** The order in which a later goal wins: `fromDay`, then `updatedAt`, then `id`. */
    private val order: Comparator<GoalEntity> =
        compareBy<GoalEntity>({ it.fromDay }, { it.record.updatedAt }, { it.record.id })

    /** The goal record that counts for [day], or null if none does. Deleted goals never count. */
    fun counting(day: Int, goals: List<GoalEntity>): GoalEntity? =
        goals.filter { it.record.deletedAt == null && it.fromDay <= day }.maxWithOrNull(order)

    /** The goal of [day], in millilitres. */
    fun goalOf(day: Int, goals: List<GoalEntity>): Int = counting(day, goals)?.amountMl ?: DEFAULT_GOAL_ML

    /**
     * What setting the goal to [amountMl] on [today] writes:
     *
     * 1. If the goal that counts for today has `fromDay` today, it is
     *    updated.
     * 2. Otherwise a new goal is created with `fromDay` today.
     * 3. If the goal of today is already [amountMl], nothing is written.
     */
    fun change(today: Int, amountMl: Int, goals: List<GoalEntity>): GoalChange {
        val current = counting(today, goals)
        return when {
            (current?.amountMl ?: DEFAULT_GOAL_ML) == amountMl -> GoalChange.NoChange
            current != null && current.fromDay == today -> GoalChange.Update(current.record.id)
            else -> GoalChange.Create
        }
    }

    /**
     * The goal of each day, for many days at once, such as the rows of
     * History. It sorts [goals] once.
     */
    class Timeline(goals: List<GoalEntity>) {
        private val sorted = goals.filter { it.record.deletedAt == null }.sortedWith(order)

        /** The goal of [day], in millilitres, as [goalOf] gives it. */
        fun goalOf(day: Int): Int = sorted.lastOrNull { it.fromDay <= day }?.amountMl ?: DEFAULT_GOAL_ML
    }
}

/** What a change of the goal writes ([GoalRules.change]). */
sealed interface GoalChange {
    /** The goal of today is already the new one. */
    data object NoChange : GoalChange

    /** The goal record with [id] counts from today: it gets the new amount. */
    data class Update(val id: String) : GoalChange

    /** A new goal record, from today. */
    data object Create : GoalChange
}
