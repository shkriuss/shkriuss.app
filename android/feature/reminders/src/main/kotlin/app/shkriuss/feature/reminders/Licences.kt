package app.shkriuss.feature.reminders

import androidx.annotation.RawRes
import androidx.annotation.StringRes

/**
 * One third-party part that ships in Reminders, for the Licences screen
 * (docs/apps/water/spec.md, "Licences", as docs/apps/reminders/spec.md,
 * "As in Water", says). [name] is its name in the list.
 * [licence] is the name of its licence. [notice] is a raw resource with
 * its notice: whose it is and where it comes from, as read at its source.
 * [text] is a raw resource with the full text of its licence, byte for
 * byte as the source has it. [id] names it in saved state.
 */
class LicensedPart(
    val id: String,
    @param:StringRes val name: Int,
    @param:StringRes val licence: Int,
    @param:RawRes val notice: Int,
    @param:RawRes val text: Int,
)

/**
 * Every third-party part that ships in Reminders, in the order the screen
 * lists them: by name. It is filled from
 * docs/development/third-party.md, which says for each part where it
 * comes from and how the list was made. One entry is one project, not
 * one file of it: the AndroidX libraries are one entry.
 *
 * "Ships" means: it is in the release APK. Some libraries are on the
 * build's class path and R8 removes them, because nothing in Reminders uses
 * them, such as Gson, which Tink names. They are not listed here. The
 * page lists them, and says how to check the APK again.
 *
 * When a library is added, changed or removed, or one of those starts to
 * ship, change this list, the page and the texts in `res/raw` together.
 * Water has a list of its own, with the same parts today (the owner's
 * decision: each app keeps its own list).
 */
object Licences {
    /** The parts, sorted by name. */
    val parts: List<LicensedPart> = listOf(
        apache("androidx", R.string.reminders_part_androidx, R.raw.reminders_notice_androidx),
        LicensedPart("bip39", R.string.reminders_part_bip39, R.string.reminders_licence_name_mit, R.raw.reminders_notice_bip39, R.raw.reminders_licence_bip39),
        apache("compose", R.string.reminders_part_compose, R.raw.reminders_notice_compose),
        apache("kotlin", R.string.reminders_part_kotlin, R.raw.reminders_notice_kotlin),
        apache("coroutines", R.string.reminders_part_coroutines, R.raw.reminders_notice_coroutines),
        LicensedPart(
            "protobuf",
            R.string.reminders_part_protobuf,
            R.string.reminders_licence_name_bsd_3_clause,
            R.raw.reminders_notice_protobuf,
            R.raw.reminders_licence_protobuf,
        ),
        apache("tink", R.string.reminders_part_tink, R.raw.reminders_notice_tink),
    )

    /** The part with the ID [id], or null. */
    fun part(id: String?): LicensedPart? = parts.firstOrNull { it.id == id }

    /** A part under the Apache License 2.0, whose text every such part shares. */
    private fun apache(id: String, @StringRes name: Int, @RawRes notice: Int) =
        LicensedPart(id, name, R.string.reminders_licence_name_apache_2_0, notice, R.raw.reminders_licence_apache_2_0)
}
