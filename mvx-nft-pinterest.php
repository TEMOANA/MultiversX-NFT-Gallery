<?php

/**
 * Plugin Name: MultiversX NFT Gallery
 * Plugin URI:  https://github.com/TEMOANA/MultiversX-NFT-Gallery
 * Description: Displays MultiversX NFT collections in a premium masonry grid. Supports client-side sorting, dynamic trait filtering, and rarity calculations.
 * Version:     1.0.0
 * Author:      TEMOANA
 * Author URI:  httpss://temoana.net
 * License:     GPL2
 * Text Domain: mvx-nft-gallery
 */

// If this file is called directly, abort.
if (! defined('ABSPATH')) {
	exit;
}

// Define Plugin Constants
define('MVX_NFT_PIN_VERSION', '1.0.0');
define('MVX_NFT_PIN_PATH', plugin_dir_path(__FILE__));
define('MVX_NFT_PIN_URL', plugin_dir_url(__FILE__));
define('MVX_NFT_PIN_BASENAME', plugin_basename(__FILE__));

// Include the core class
require_once MVX_NFT_PIN_PATH . 'includes/class-mvx-nft-gallery.php';

/**
 * Begins execution of the plugin.
 */
function run_mvx_nft_pinterest()
{
	$plugin = new MVX_NFT_Gallery();
	$plugin->run();
}
run_mvx_nft_pinterest();
