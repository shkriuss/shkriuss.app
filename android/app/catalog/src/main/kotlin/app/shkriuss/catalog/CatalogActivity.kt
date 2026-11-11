package app.shkriuss.catalog

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import app.shkriuss.core.design.ShkTheme

/**
 * The Catalog app's only activity. It shows the design gallery: the start
 * screen and a page for each group of design tokens.
 */
class CatalogActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            ShkTheme {
                CatalogApp()
            }
        }
    }
}
