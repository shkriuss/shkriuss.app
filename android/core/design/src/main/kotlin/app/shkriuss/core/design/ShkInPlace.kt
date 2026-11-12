package app.shkriuss.core.design

/**
 * Marks the functions that draw a component that opens in a window of its
 * own, such as a dialog or a menu, in place on a page instead. Each draws
 * the same panel as the component, with the same text and states, but no
 * window, no scrim and no motion, and its actions only call their
 * `onClick`.
 *
 * They exist for the Catalog, so it can show every state of these
 * components side by side, and its screenshots can check them. An app
 * never uses them: it opens the component itself, such as [ShkDialog].
 * Using one without `@OptIn(ShkInPlace::class)` stops the build.
 */
@RequiresOptIn(
    message = "Draws a component in place, for the Catalog only. In an app, open the component itself.",
    level = RequiresOptIn.Level.ERROR,
)
@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.FUNCTION)
annotation class ShkInPlace
