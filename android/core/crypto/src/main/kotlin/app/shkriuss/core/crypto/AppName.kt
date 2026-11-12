package app.shkriuss.core.crypto

/**
 * The name of one app of the suite: the part of the application ID after
 * `app.shkriuss.`, for example `water`. It is part of every key derivation
 * label, so each app gets its own keys.
 *
 * Only the lower-case letters `a` to `z` are allowed. A preview build has
 * the same app name as its app.
 */
class AppName private constructor(val value: String) {
    /**
     * False for `sync` and `catalog`. Those apps hold no data keys, and no
     * keys are ever derived for them.
     */
    val holdsDataKeys: Boolean get() = value !in WITHOUT_DATA_KEYS

    override fun equals(other: Any?): Boolean = other is AppName && other.value == value

    override fun hashCode(): Int = value.hashCode()

    override fun toString(): String = value

    companion object {
        private const val ID_PREFIX = "app.shkriuss."
        private const val PREVIEW_SUFFIX = ".preview"
        private val WITHOUT_DATA_KEYS = setOf("sync", "catalog")

        /** The app name [value]. Throws if it is empty or holds anything but `a` to `z`. */
        fun of(value: String): AppName {
            require(value.isNotEmpty() && value.all { it in 'a'..'z' }) {
                "An app name holds only the letters a to z"
            }
            return AppName(value)
        }

        /**
         * The app name of an application ID such as `app.shkriuss.water` or
         * `app.shkriuss.water.preview`. Throws for any other ID.
         */
        fun fromApplicationId(applicationId: String): AppName {
            require(applicationId.startsWith(ID_PREFIX)) { "Not an application ID of the suite" }
            return of(applicationId.removePrefix(ID_PREFIX).removeSuffix(PREVIEW_SUFFIX))
        }
    }
}
