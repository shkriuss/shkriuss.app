package app.shkriuss.feature.water

import androidx.annotation.RawRes
import androidx.annotation.StringRes

/**
 * One third-party part that ships in Water, for the Licences screen
 * (docs/apps/water/spec.md, "Licences"). [name] is its name in the list.
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
 * Every third-party part that ships in Water, in the order the screen
 * lists them: by name. It is filled from
 * docs/development/third-party.md, which says for each part where it
 * comes from and how the list was made. One entry is one project, not
 * one file of it: the AndroidX libraries are one entry.
 *
 * When a library is added, changed or removed, change this list, the page
 * and the texts in `res/raw` together.
 */
object Licences {
    /** The parts, sorted by name. */
    val parts: List<LicensedPart> = listOf(
        apache("androidx", R.string.water_part_androidx, R.raw.water_notice_androidx),
        LicensedPart("bip39", R.string.water_part_bip39, R.string.water_licence_name_mit, R.raw.water_notice_bip39, R.raw.water_licence_bip39),
        apache("error_prone", R.string.water_part_error_prone, R.raw.water_notice_error_prone),
        apache("gson", R.string.water_part_gson, R.raw.water_notice_gson),
        apache("guava", R.string.water_part_guava, R.raw.water_notice_guava),
        apache("jetbrains_annotations", R.string.water_part_jetbrains_annotations, R.raw.water_notice_jetbrains_annotations),
        apache("compose", R.string.water_part_compose, R.raw.water_notice_compose),
        apache("jspecify", R.string.water_part_jspecify, R.raw.water_notice_jspecify),
        LicensedPart(
            "jsr305",
            R.string.water_part_jsr305,
            R.string.water_licence_name_bsd_3_clause,
            R.raw.water_notice_jsr305,
            R.raw.water_licence_jsr305,
        ),
        apache("kotlin", R.string.water_part_kotlin, R.raw.water_notice_kotlin),
        apache("coroutines", R.string.water_part_coroutines, R.raw.water_notice_coroutines),
        apache("serialization", R.string.water_part_serialization, R.raw.water_notice_serialization),
        LicensedPart(
            "protobuf",
            R.string.water_part_protobuf,
            R.string.water_licence_name_bsd_3_clause,
            R.raw.water_notice_protobuf,
            R.raw.water_licence_protobuf,
        ),
        apache("tink", R.string.water_part_tink, R.raw.water_notice_tink),
    )

    /** The part with the ID [id], or null. */
    fun part(id: String?): LicensedPart? = parts.firstOrNull { it.id == id }

    /** A part under the Apache License 2.0, whose text every such part shares. */
    private fun apache(id: String, @StringRes name: Int, @RawRes notice: Int) =
        LicensedPart(id, name, R.string.water_licence_name_apache_2_0, notice, R.raw.water_licence_apache_2_0)
}
