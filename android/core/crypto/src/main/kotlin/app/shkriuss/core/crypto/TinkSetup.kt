package app.shkriuss.core.crypto

import com.google.crypto.tink.aead.AeadConfig
import com.google.crypto.tink.keyderivation.KeyDerivationConfig
import com.google.crypto.tink.prf.PrfConfig
import com.google.crypto.tink.streamingaead.StreamingAeadConfig
import java.security.Security

/**
 * Gets Tink ready, and refuses to work next to a Play services provider.
 * Every way into this module calls [ready] first.
 */
internal object TinkSetup {
    /** The provider that Google Play services installs. Tink would use it if it were there. */
    const val PLAY_SERVICES_PROVIDER = "GmsCore_OpenSSL"

    private val registered: Unit by lazy {
        AeadConfig.register()
        StreamingAeadConfig.register()
        PrfConfig.register()
        KeyDerivationConfig.register()
    }

    /**
     * Checks for the Play services provider, then registers the Tink
     * primitives this module uses, once. The check runs every time, because
     * a provider can be installed at any moment.
     */
    fun ready() {
        if (Security.getProvider(PLAY_SERVICES_PROVIDER) != null) {
            throw PlayServicesProviderException()
        }
        registered
    }
}

/**
 * Thrown when a security provider of Google Play services is installed in
 * this app. The apps never use Play services (hard rule 3), so
 * `core/crypto` refuses to work.
 */
class PlayServicesProviderException internal constructor() :
    IllegalStateException("A Google Play services security provider is installed. core/crypto refuses to work.")
