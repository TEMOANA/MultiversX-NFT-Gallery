<?php
/**
 * Core plugin class of the MultiversX NFT Pinterest Gallery.
 * Handles admin panels, API fetching, caching, and shortcode registration.
 */

// If this file is called directly, abort.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class MVX_NFT_Gallery {

	/**
	 * Constructor. Registers all necessary hooks.
	 */
	public function __construct() {
		// Define default options
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_menu', array( $this, 'add_admin_menu' ) );
		
		// Enqueue scripts and styles
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_public_assets' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );

		// Register Shortcode
		add_shortcode( 'mvx_nft_gallery', array( $this, 'render_shortcode' ) );

		// Clear cache when settings are updated
		add_action( 'update_option_mvx_nft_default_collection', array( $this, 'clear_transient_cache' ) );
		add_action( 'update_option_mvx_nft_network', array( $this, 'clear_transient_cache' ) );
		add_action( 'update_option_mvx_nft_cache_time', array( $this, 'clear_transient_cache' ) );
	}

	/**
	 * Run the plugin by hook connections.
	 */
	public function run() {
		// Executed at bootstrap
	}

	/**
	 * Enqueue frontend CSS and JS.
	 */
	public function enqueue_public_assets() {
		wp_register_style(
			'mvx-nft-pinterest-public-css',
			MVX_NFT_PIN_URL . 'public/css/mvx-nft-public.css',
			array(),
			filemtime( MVX_NFT_PIN_PATH . 'public/css/mvx-nft-public.css' )
		);

		wp_register_script(
			'mvx-nft-pinterest-public-js',
			MVX_NFT_PIN_URL . 'public/js/mvx-nft-public.js',
			array(),
			filemtime( MVX_NFT_PIN_PATH . 'public/js/mvx-nft-public.js' ),
			true
		);
	}

	/**
	 * Enqueue admin scripts/styles.
	 */
	public function enqueue_admin_assets( $hook ) {
		if ( 'settings_page_mvx-nft-pinterest-settings' !== $hook ) {
			return;
		}

		wp_enqueue_style(
			'mvx-nft-pinterest-admin-css',
			MVX_NFT_PIN_URL . 'admin/admin-style.css',
			array(),
			MVX_NFT_PIN_VERSION
		);
	}

	/**
	 * Add Admin Menu.
	 */
	public function add_admin_menu() {
		add_options_page(
			__( 'MVX Pinterest Gallery Settings', 'mvx-nft-pinterest' ),
			__( 'MVX NFT Gallery', 'mvx-nft-pinterest' ),
			'manage_options',
			'mvx-nft-pinterest-settings',
			array( $this, 'render_admin_settings_page' )
		);
	}

	/**
	 * Register Plugin Settings.
	 */
	public function register_settings() {
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_default_collection' );
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_network', array( 'default' => 'mainnet' ) );
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_cache_time', array( 'default' => '43200' ) ); // Default 12 hours
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_theme', array( 'default' => 'glassmorphism' ) );
		
		// Card customization styling
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_accent_color', array( 'default' => '#23F3D2' ) ); // Premium teal
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_bg_color', array( 'default' => '#13151A' ) ); // Dark
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_card_bg', array( 'default' => 'rgba(255, 255, 255, 0.05)' ) ); // Glass card
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_card_radius', array( 'default' => '16' ) );
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_default_rows', array( 'default' => '3' ) );
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_default_sort', array( 'default' => 'newest' ) );
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_show_filters', array( 'default' => '1' ) );
		register_setting( 'mvx_nft_settings_group', 'mvx_nft_show_search', array( 'default' => '1' ) );
	}

	/**
	 * Delete all transient cache keys starting with 'mvx_nfts_'
	 */
	public function clear_transient_cache() {
		global $wpdb;
		$wpdb->query( "DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_mvx_nfts_%' OR option_name LIKE '_transient_timeout_mvx_nfts_%'" );
	}

	/**
	 * Helper to fetch a single NFT collection with Transient caching.
	 */
	private function fetch_single_collection_nfts( $collection_id, $limit ) {
		if ( empty( $collection_id ) ) {
			return array();
		}

		$network = get_option( 'mvx_nft_network', 'mainnet' );
		$cache_time = (int) get_option( 'mvx_nft_cache_time', 43200 );

		// Determine API base url
		switch ( $network ) {
			case 'devnet':
				$api_url = 'https://devnet-api.multiversx.com';
				break;
			case 'testnet':
				$api_url = 'https://testnet-api.multiversx.com';
				break;
			case 'mainnet':
			default:
				$api_url = 'https://api.multiversx.com';
				break;
		}

		// Cache transient key based on collection, limit, network and version to clear stale cache
		$transient_key = 'mvx_nfts_' . substr( md5( $collection_id . '_' . $limit . '_' . $network . '_v7' ), 0, 30 );
		$cached_data = get_transient( $transient_key );

		if ( false !== $cached_data ) {
			return $cached_data;
		}

		// Query MultiversX API
		// We only fetch fields we need to keep payload tiny
		$endpoint = sprintf(
			'%s/collections/%s/nfts?size=%d&fields=identifier,nonce,name,uris,url,media,metadata,tags',
			$api_url,
			urlencode( $collection_id ),
			(int) $limit
		);

		$response = wp_remote_get( $endpoint, array( 'timeout' => 15 ) );

		if ( is_wp_error( $response ) ) {
			return array();
		}

		$code = wp_remote_retrieve_response_code( $response );
		if ( 200 !== $code ) {
			return array();
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		// Fallback for gateway wrappers check (just in case)
		if ( isset( $data['data'] ) && is_array( $data['data'] ) && ! isset( $data['identifier'] ) ) {
			$data = $data['data'];
		}

		if ( ! is_array( $data ) ) {
			return array();
		}

		// Sanitize/Preprocess data if necessary
		$nfts = array();
		foreach ( $data as $nft ) {
			if ( ! isset( $nft['identifier'] ) ) {
				continue;
			}

			// Resolve image and video URLs
			$image_url = '';
			$video_url = '';

			if ( isset( $nft['media'] ) && is_array( $nft['media'] ) ) {
				foreach ( $nft['media'] as $media ) {
					$file_type = isset( $media['fileType'] ) ? $media['fileType'] : '';
					$url = isset( $media['url'] ) ? $media['url'] : '';

					if ( empty( $url ) ) {
						continue;
					}

					// MultiversX IPFS gateway replacement helper
					if ( strpos( $url, 'ipfs://' ) === 0 ) {
						$url = str_replace( 'ipfs://', 'https://ipfs.io/ipfs/', $url );
					}

					// Detect video
					if ( strpos( $file_type, 'video/' ) === 0 || in_array( pathinfo( parse_url( $url, PHP_URL_PATH ), PATHINFO_EXTENSION ), array( 'mp4', 'webm', 'ogg', 'mov' ) ) ) {
						$video_url = $url;
					} else {
						// Keep track of the first non-video thumbnail or url
						if ( empty( $image_url ) ) {
							$image_url = isset( $media['thumbnailUrl'] ) && ! empty( $media['thumbnailUrl'] ) ? $media['thumbnailUrl'] : $url;
						}
					}
				}
			}

			// Fallbacks based on uris array
			$fallback_image_url = '';
			if ( isset( $nft['uris'] ) && is_array( $nft['uris'] ) ) {
				foreach ( $nft['uris'] as $uri ) {
					// MultiversX API returns raw URIs in the 'uris' array as base64-encoded strings.
					// If the URI is not already a decoded URL, try to base64-decode it.
					if ( strpos( $uri, '://' ) === false && strpos( $uri, 'http' ) !== 0 ) {
						$decoded = base64_decode( $uri, true );
						if ( $decoded !== false && ( strpos( $decoded, '://' ) !== false || strpos( $decoded, 'http' ) === 0 ) ) {
							$uri = $decoded;
						}
					}

					// Ignore metadata.json or other json files in uris array
					if ( preg_match( '/\.json(\?|$)/i', $uri ) || strpos( strtolower( $uri ), 'metadata.json' ) !== false ) {
						continue;
					}

					// Ignore directory or home URLs (ending with a slash)
					if ( substr( trim( $uri ), -1 ) === '/' ) {
						continue;
					}

					// Ignore homepage or domain-only URLs of the current site (no path)
					$home_host = str_replace( 'www.', '', strtolower( wp_parse_url( home_url(), PHP_URL_HOST ) ) );
					$parsed = parse_url( $uri );
					$host = isset( $parsed['host'] ) ? str_replace( 'www.', '', strtolower( $parsed['host'] ) ) : '';
					if ( ! empty( $host ) && $host === $home_host ) {
						$path = isset( $parsed['path'] ) ? trim( $parsed['path'], '/' ) : '';
						if ( empty( $path ) ) {
							continue;
						}
					}

					if ( strpos( $uri, 'ipfs://' ) === 0 ) {
						$uri = str_replace( 'ipfs://', 'https://ipfs.io/ipfs/', $uri );
					}

					$ext = pathinfo( parse_url( $uri, PHP_URL_PATH ), PATHINFO_EXTENSION );
					$is_video = in_array( strtolower( $ext ), array( 'mp4', 'webm', 'ogg', 'mov' ) );

					if ( $is_video ) {
						if ( empty( $video_url ) ) {
							$video_url = $uri;
						}
					} else {
						if ( empty( $fallback_image_url ) ) {
							$fallback_image_url = $uri;
						}
						if ( empty( $image_url ) ) {
							$image_url = $uri;
						}
					}
				}
			}

			if ( $image_url === $fallback_image_url ) {
				$fallback_image_url = '';
			}

			// If we only have a video and no thumbnail image, fall back to displaying the video or a static video placeholder
			if ( empty( $image_url ) && ! empty( $video_url ) ) {
				$image_url = $video_url;
			}

			$nfts[] = array(
				'identifier'    => sanitize_text_field( $nft['identifier'] ),
				'nonce'         => (int) $nft['nonce'],
				'name'          => sanitize_text_field( $nft['name'] ),
				'image'         => esc_url_raw( $image_url ),
				'video'         => esc_url_raw( $video_url ),
				'imageFallback' => esc_url_raw( $fallback_image_url ),
				'explorerUrl'   => esc_url_raw( isset( $nft['url'] ) ? $nft['url'] : 'https://explorer.multiversx.com/nfts/' . $nft['identifier'] ),
				'description'   => isset( $nft['metadata']['description'] ) ? sanitize_textarea_field( $nft['metadata']['description'] ) : '',
				'attributes'    => isset( $nft['metadata']['attributes'] ) && is_array( $nft['metadata']['attributes'] ) ? $nft['metadata']['attributes'] : array(),
				'tags'          => isset( $nft['tags'] ) && is_array( $nft['tags'] ) ? $nft['tags'] : array(),
			);
		}

		// Set transient cache
		if ( ! empty( $nfts ) ) {
			set_transient( $transient_key, $nfts, $cache_time );
		}

		return $nfts;
	}

	/**
	 * Fetch NFT Data from MultiversX API (supports comma-separated list of collection IDs).
	 */
	public function get_nfts( $collection_id, $limit = 100 ) {
		if ( empty( $collection_id ) ) {
			return array();
		}

		$collection_ids = array_map( 'trim', explode( ',', $collection_id ) );
		$all_nfts = array();

		foreach ( $collection_ids as $col_id ) {
			$col_nfts = $this->fetch_single_collection_nfts( $col_id, $limit );
			if ( is_array( $col_nfts ) ) {
				$all_nfts = array_merge( $all_nfts, $col_nfts );
			}
		}

		return $all_nfts;
	}

	/**
	 * Shortcode callback: [mvx_nft_gallery]
	 */
	public function render_shortcode( $atts ) {
		$default_collection = get_option( 'mvx_nft_default_collection', '' );
		
		// Parse attributes
		$args = shortcode_atts(
			array(
				'collection' => $default_collection,
				'limit'      => '100',
				'columns'    => '4',
				'rows'       => get_option( 'mvx_nft_default_rows', '3' ),
				'sort'       => get_option( 'mvx_nft_default_sort', 'newest' ),
				'theme'      => get_option( 'mvx_nft_theme', 'glassmorphism' ),
			),
			$atts,
			'mvx_nft_gallery'
		);

		if ( empty( $args['collection'] ) ) {
			return '<p style="color:#ff4d4d; font-weight:bold; padding: 10px; border:1px solid #ff4d4d; border-radius:5px;">' . esc_html__( 'Error: Please specify a collection ID in the shortcode or default settings.', 'mvx-nft-pinterest' ) . '</p>';
		}

		// Fetch NFTs
		$nfts = $this->get_nfts( $args['collection'], $args['limit'] );

		if ( empty( $nfts ) ) {
			return '<p style="color:#ffaa00; font-weight:bold; padding: 10px; border:1px solid #ffaa00; border-radius:5px;">' . esc_html__( 'No NFTs found or unable to connect to MultiversX API. Check your collection ID.', 'mvx-nft-pinterest' ) . '</p>';
		}

		// Enqueue the scripts & styles
		wp_enqueue_style( 'mvx-nft-pinterest-public-css' );
		wp_enqueue_script( 'mvx-nft-pinterest-public-js' );

		// Localize parameters for the specific grid instance
		$instance_id = uniqid( 'mvx_grid_' );
		
		// Get custom colors/styles from Settings
		$accent_color = get_option( 'mvx_nft_accent_color', '#23F3D2' );
		$bg_color     = get_option( 'mvx_nft_bg_color', '#13151A' );
		$card_bg      = get_option( 'mvx_nft_card_bg', 'rgba(255, 255, 255, 0.05)' );
		$card_radius  = get_option( 'mvx_nft_card_radius', '16' );
		$show_filters = get_option( 'mvx_nft_show_filters', '1' );
		$show_search  = get_option( 'mvx_nft_show_search', '1' );

		wp_localize_script(
			'mvx-nft-pinterest-public-js',
			$instance_id . '_data',
			array(
				'nfts'        => $nfts,
				'accentColor' => $accent_color,
				'theme'       => $args['theme'],
				'columns'     => (int) $args['columns'],
				'rows'        => is_numeric( $args['rows'] ) ? (int) $args['rows'] : sanitize_text_field( $args['rows'] ),
				'sortBy'      => sanitize_text_field( $args['sort'] ),
				'showFilters' => ( '1' === $show_filters ),
				'showSearch'  => ( '1' === $show_search ),
			)
		);

		// Output dynamic style block for settings (target both container and modal ref)
		$custom_css = "
			#{$instance_id}-container,
			.mvx-nft-modal[data-instance-ref='{$instance_id}'] {
				--mvx-accent-color: {$accent_color};
				--mvx-bg-color: {$bg_color};
				--mvx-card-bg: {$card_bg};
				--mvx-card-radius: {$card_radius}px;
			}
		";
		wp_add_inline_style( 'mvx-nft-pinterest-public-css', $custom_css );

		// Build output HTML
		ob_start();
		?>
		<div id="<?php echo esc_attr( $instance_id ); ?>-container" class="mvx-nft-container mvx-theme-<?php echo esc_attr( $args['theme'] ); ?>" data-instance="<?php echo esc_attr( $instance_id ); ?>">
			
			<!-- Loader -->
			<div class="mvx-nft-loader">
				<div class="mvx-spinner"></div>
				<p><?php esc_html_e( 'Loading collection details...', 'mvx-nft-pinterest' ); ?></p>
			</div>

			<!-- Filter Toggle Button -->
			<?php if ( '1' === $show_filters || '1' === $show_search ) : ?>
			<div class="mvx-nft-toggle-wrapper">
				<button class="mvx-btn mvx-btn-toggle-filters">
					<span class="mvx-toggle-icon">▼</span> <?php esc_html_e( 'Filters & Sorting', 'mvx-nft-pinterest' ); ?>
				</button>
			</div>
			<?php endif; ?>

			<!-- Filter Bar (Populated by JS, hidden by default) -->
			<div class="mvx-nft-filter-bar" style="display:none;"></div>

			<!-- Pinterest-Style Masonry Grid -->
			<div class="mvx-nft-grid" style="--mvx-grid-columns: <?php echo esc_attr( $args['columns'] ); ?>;">
				<!-- Cards populated by JS for real-time reactivity -->
			</div>

			<!-- Pagination Control Panel (Populated by JS) -->
			<div class="mvx-nft-pagination" style="display:none;">
				<button class="mvx-btn mvx-btn-secondary mvx-btn-prev" disabled><?php esc_html_e( '← Previous', 'mvx-nft-pinterest' ); ?></button>
				<span class="mvx-pagination-info">Page 1 of 1</span>
				<button class="mvx-btn mvx-btn-secondary mvx-btn-next" disabled><?php esc_html_e( 'Next →', 'mvx-nft-pinterest' ); ?></button>
			</div>

			<!-- Lightbox Modal Container (inherits instance ID and theme class) -->
			<div class="mvx-nft-modal mvx-theme-<?php echo esc_attr( $args['theme'] ); ?>" data-instance-ref="<?php echo esc_attr( $instance_id ); ?>" style="display:none;">
				<div class="mvx-nft-modal-overlay"></div>
				<div class="mvx-nft-modal-content">
					<button class="mvx-nft-modal-close" aria-label="<?php esc_attr_e( 'Close', 'mvx-nft-pinterest' ); ?>">&times;</button>
					<div class="mvx-nft-modal-body">
						<!-- Content loaded dynamically -->
					</div>
				</div>
			</div>

		</div>
		<?php
		return ob_get_clean();
	}

	/**
	 * Render the WP Admin settings page
	 */
	public function render_admin_settings_page() {
		// Purge transient cache when visiting settings page to assist development
		$this->clear_transient_cache();
		?>
		<div class="wrap mvx-nft-admin-wrap">
			<h1><?php esc_html_e( 'MultiversX NFT Pinterest Gallery Settings', 'mvx-nft-pinterest' ); ?></h1>
			<p class="description"><?php esc_html_e( 'Configure options for retrieving and styling your NFT collection gallery.', 'mvx-nft-pinterest' ); ?></p>

			<form method="post" action="options.php">
				<?php settings_fields( 'mvx_nft_settings_group' ); ?>
				<?php do_settings_sections( 'mvx_nft_settings_group' ); ?>

				<table class="form-table">
					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Default Collection ID', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="text" name="mvx_nft_default_collection" value="<?php echo esc_attr( get_option( 'mvx_nft_default_collection' ) ); ?>" class="regular-text" placeholder="e.g. EGLD-123456" />
							<p class="description"><?php esc_html_e( 'Enter the ESDT collection identifier (case sensitive).', 'mvx-nft-pinterest' ); ?></p>
						</td>
					</tr>
					
					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'API Network', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<?php $network = get_option( 'mvx_nft_network', 'mainnet' ); ?>
							<select name="mvx_nft_network">
								<option value="mainnet" <?php selected( $network, 'mainnet' ); ?>><?php esc_html_e( 'Mainnet (api.multiversx.com)', 'mvx-nft-pinterest' ); ?></option>
								<option value="devnet" <?php selected( $network, 'devnet' ); ?>><?php esc_html_e( 'Devnet (devnet-api.multiversx.com)', 'mvx-nft-pinterest' ); ?></option>
								<option value="testnet" <?php selected( $network, 'testnet' ); ?>><?php esc_html_e( 'Testnet (testnet-api.multiversx.com)', 'mvx-nft-pinterest' ); ?></option>
							</select>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Cache Time (Transients)', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="number" name="mvx_nft_cache_time" value="<?php echo esc_attr( get_option( 'mvx_nft_cache_time', 43200 ) ); ?>" class="small-text" />
							<span class="description"><?php esc_html_e( 'seconds (e.g. 43200 = 12 hours). Set to 0 to disable caching (not recommended for production).', 'mvx-nft-pinterest' ); ?></span>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Default Theme Preset', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<?php $theme = get_option( 'mvx_nft_theme', 'glassmorphism' ); ?>
							<select name="mvx_nft_theme">
								<option value="glassmorphism" <?php selected( $theme, 'glassmorphism' ); ?>><?php esc_html_e( 'Dark Glassmorphism (Premium)', 'mvx-nft-pinterest' ); ?></option>
								<option value="light" <?php selected( $theme, 'light' ); ?>><?php esc_html_e( 'Clean Light Theme', 'mvx-nft-pinterest' ); ?></option>
								<option value="cyberpunk" <?php selected( $theme, 'cyberpunk' ); ?>><?php esc_html_e( 'Cyberpunk (Dark + Accent Glow)', 'mvx-nft-pinterest' ); ?></option>
							</select>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row" colspan="2"><h3><?php esc_html_e( 'Design & Layout Options', 'mvx-nft-pinterest' ); ?></h3></th>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Accent Color', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="color" name="mvx_nft_accent_color" value="<?php echo esc_attr( get_option( 'mvx_nft_accent_color', '#23F3D2' ) ); ?>" />
							<span class="description"><?php esc_html_e( 'Primary color for accents, filters, borders, and buttons.', 'mvx-nft-pinterest' ); ?></span>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Container Background', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="color" name="mvx_nft_bg_color" value="<?php echo esc_attr( get_option( 'mvx_nft_bg_color', '#13151A' ) ); ?>" />
							<span class="description"><?php esc_html_e( 'Background of the gallery section (useful for matching theme).', 'mvx-nft-pinterest' ); ?></span>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Card Background', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="text" name="mvx_nft_card_bg" value="<?php echo esc_attr( get_option( 'mvx_nft_card_bg', 'rgba(255, 255, 255, 0.05)' ) ); ?>" class="regular-text" />
							<p class="description"><?php esc_html_e( 'Background color of individual cards. Supports Hex, RGB, or RGBA (useful for transparency effects).', 'mvx-nft-pinterest' ); ?></p>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Card Border Radius', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="number" name="mvx_nft_card_radius" value="<?php echo esc_attr( get_option( 'mvx_nft_card_radius', '16' ) ); ?>" class="small-text" /> px
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Default Rows per Page', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="text" name="mvx_nft_default_rows" value="<?php echo esc_attr( get_option( 'mvx_nft_default_rows', '3' ) ); ?>" class="small-text" />
							<p class="description"><?php esc_html_e( 'Specify how many rows of NFTs to display per page. Set to "all" to disable pagination.', 'mvx-nft-pinterest' ); ?></p>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Default Sort Order', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<?php $default_sort = get_option( 'mvx_nft_default_sort', 'newest' ); ?>
							<select name="mvx_nft_default_sort">
								<option value="newest" <?php selected( $default_sort, 'newest' ); ?>><?php esc_html_e( 'Newest Minted (Nonce Desc)', 'mvx-nft-pinterest' ); ?></option>
								<option value="oldest" <?php selected( $default_sort, 'oldest' ); ?>><?php esc_html_e( 'Oldest Minted (Nonce Asc)', 'mvx-nft-pinterest' ); ?></option>
								<option value="rarity-rare" <?php selected( $default_sort, 'rarity-rare' ); ?>><?php esc_html_e( 'Rarest First', 'mvx-nft-pinterest' ); ?></option>
								<option value="rarity-common" <?php selected( $default_sort, 'rarity-common' ); ?>><?php esc_html_e( 'Common First', 'mvx-nft-pinterest' ); ?></option>
								<option value="alpha-asc" <?php selected( $default_sort, 'alpha-asc' ); ?>><?php esc_html_e( 'Name: A - Z', 'mvx-nft-pinterest' ); ?></option>
								<option value="alpha-desc" <?php selected( $default_sort, 'alpha-desc' ); ?>><?php esc_html_e( 'Name: Z - A', 'mvx-nft-pinterest' ); ?></option>
								<option value="random" <?php selected( $default_sort, 'random' ); ?>><?php esc_html_e( 'Random Display', 'mvx-nft-pinterest' ); ?></option>
							</select>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Enable Search Input', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="checkbox" name="mvx_nft_show_search" value="1" <?php checked( get_option( 'mvx_nft_show_search', '1' ), '1' ); ?> />
							<span class="description"><?php esc_html_e( 'Display search input box above the grid.', 'mvx-nft-pinterest' ); ?></span>
						</td>
					</tr>

					<tr valign="top">
						<th scope="row"><?php esc_html_e( 'Enable Dynamic Filters', 'mvx-nft-pinterest' ); ?></th>
						<td>
							<input type="checkbox" name="mvx_nft_show_filters" value="1" <?php checked( get_option( 'mvx_nft_show_filters', '1' ), '1' ); ?> />
							<span class="description"><?php esc_html_e( 'Display attribute and category filters.', 'mvx-nft-pinterest' ); ?></span>
						</td>
					</tr>
				</table>

				<?php submit_button(); ?>
			</form>

			<hr />

			<h2><?php esc_html_e( 'Usage Instructions', 'mvx-nft-pinterest' ); ?></h2>
			<p><?php esc_html_e( 'To display the gallery on a page or post, paste the following shortcode:', 'mvx-nft-pinterest' ); ?></p>
			<code>[mvx_nft_gallery]</code>
			<p><?php esc_html_e( 'You can override default settings using shortcode attributes:', 'mvx-nft-pinterest' ); ?></p>
			<code>[mvx_nft_gallery collection="COLLECTION-123456" limit="50" columns="3" theme="light"]</code>
		</div>
		<?php
	}
}
