package app.shkriuss.feature.notes.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntSize
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkLoadingState
import app.shkriuss.core.design.ShkMenuItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkStateAction
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.feature.notes.NoteFile
import app.shkriuss.feature.notes.NoteImages
import app.shkriuss.feature.notes.R

/**
 * The image view (docs/apps/notes/spec.md, "The image view"): in place of
 * the note, in the same pane. Its top bar has Back, the file's name, and a
 * menu with **Save a copy** and **Remove**. Back goes to the note. While
 * the image is decoded it shows `ShkLoadingState`; when it cannot be
 * shown, "Notes cannot show this image.", with **Save a copy**.
 *
 * The image fits the pane. Pinch to zoom from 1× to 5×, drag to move it
 * while zoomed, double tap to switch between 1× and 2.5×. TalkBack reads
 * the file's name, and offers "Zoom in" and "Zoom out". The decoded image
 * is held only while the view shows.
 */
@Composable
internal fun ImageContent(file: NoteFile, images: NoteImages, actions: FileActions, snackbar: ShkSnackbarHostState, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val menu = listOf(
        ShkMenuItem(text = stringResource(R.string.notes_save_copy), onClick = { actions.saveCopy(file) }),
        ShkMenuItem(text = stringResource(R.string.notes_remove), onClick = { actions.remove(file) }, destructive = true),
    )
    ShkScreen(
        topBar = { ShkTopBar(title = file.name, onBack = onBack, menuItems = menu) },
        snackbarHostState = snackbar,
    ) {
        // Zoomed, the image is drawn larger than its place: it stays in the pane, under the top bar and beside the list.
        BoxWithConstraints(Modifier.weight(1f).clipToBounds()) {
            // Fitted in the pane as it is, so a pane that is not square holds no more than the image shows.
            val width = with(LocalDensity.current) { maxWidth.roundToPx() }
            val height = with(LocalDensity.current) { maxHeight.roundToPx() }
            val decoded by produceState<Decoded>(Decoded.Loading, file.id, width, height) {
                value = images.decode(file, width, height)?.let { Decoded.Shown(it.asImageBitmap()) } ?: Decoded.Failed
            }
            when (val image = decoded) {
                Decoded.Loading -> ShkLoadingState(text = stringResource(R.string.notes_opening_image))
                Decoded.Failed -> ShkErrorState(
                    title = stringResource(R.string.notes_cannot_show),
                    action = ShkStateAction(stringResource(R.string.notes_save_copy)) { actions.saveCopy(file) },
                )
                is Decoded.Shown -> ZoomableImage(image.bitmap, file.name)
            }
        }
    }
}

/** How far the decoding of the image has got. */
private sealed interface Decoded {
    data object Loading : Decoded

    data object Failed : Decoded

    data class Shown(val bitmap: ImageBitmap) : Decoded
}

/**
 * The image, fitted to the space, that zooms from 1× to 5× with a pinch,
 * moves while zoomed with a drag, and switches between 1× and 2.5× with a
 * double tap. It never moves past its edges. TalkBack reads [name] and
 * offers "Zoom in" and "Zoom out".
 */
@Composable
private fun ZoomableImage(bitmap: ImageBitmap, name: String) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var space by remember { mutableStateOf(IntSize.Zero) }
    val image = IntSize(bitmap.width, bitmap.height)
    val centre = { Offset(space.width / 2f, space.height / 2f) }
    val zoomTo = { next: Float, around: Offset ->
        val clamped = next.coerceIn(MIN_ZOOM, MAX_ZOOM)
        // The point of the image under the fingers stays under them.
        val ratio = clamped / scale
        val moved = offset * ratio + (around - centre()) * (1f - ratio)
        scale = clamped
        offset = limited(moved, clamped, space, image)
    }
    val zoomIn = stringResource(R.string.notes_zoom_in)
    val zoomOut = stringResource(R.string.notes_zoom_out)
    Image(
        bitmap = bitmap,
        contentDescription = name,
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .fillMaxSize()
            .onSizeChanged { space = it }
            .pointerInput(Unit) {
                detectTransformGestures { centroid, pan, zoom, _ ->
                    zoomTo(scale * zoom, centroid)
                    offset = limited(offset + pan, scale, space, image)
                }
            }
            .pointerInput(Unit) {
                detectTapGestures(onDoubleTap = { at -> zoomTo(if (scale > MIN_ZOOM) MIN_ZOOM else DOUBLE_TAP_ZOOM, at) })
            }
            .semantics {
                customActions = listOf(
                    CustomAccessibilityAction(zoomIn) {
                        zoomTo(scale * ZOOM_STEP, centre())
                        true
                    },
                    CustomAccessibilityAction(zoomOut) {
                        zoomTo(scale / ZOOM_STEP, centre())
                        true
                    },
                )
            }
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                translationX = offset.x
                translationY = offset.y
            },
    )
}

/**
 * [offset] kept so that an image of [image] pixels, fitted into a space of
 * [space] and zoomed by [scale], never moves past its edges: it moves only
 * as far as it is larger than the space, each way, and not at all where it
 * is smaller.
 */
internal fun limited(offset: Offset, scale: Float, space: IntSize, image: IntSize): Offset {
    if (image.width <= 0 || image.height <= 0) return Offset.Zero
    val fit = minOf(space.width.toFloat() / image.width, space.height.toFloat() / image.height)
    val reachX = ((image.width * fit * scale - space.width) / 2f).coerceAtLeast(0f)
    val reachY = ((image.height * fit * scale - space.height) / 2f).coerceAtLeast(0f)
    return Offset(offset.x.coerceIn(-reachX, reachX), offset.y.coerceIn(-reachY, reachY))
}

private const val MIN_ZOOM = 1f
private const val MAX_ZOOM = 5f
private const val DOUBLE_TAP_ZOOM = 2.5f

/** How much "Zoom in" and "Zoom out" of TalkBack change the zoom. */
private const val ZOOM_STEP = 1.5f
