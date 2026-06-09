<?php
/**
 * Plugin Name: Central Dashboard Connector
 * Description: Connects your WordPress site to a central React Dashboard. Generates a secure API key and exposes REST API endpoints for secure remote management.
 * Version: 1.0.0
 * Author: Antigravity AI
 * License: GPL2
 */

// Prevent direct access
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WP_Dashboard_Connector {

    private $option_key = 'wp_dashboard_connector_key';

    public function __construct() {
        // Activation hook to generate API key
        register_activation_hook( __FILE__, array( $this, 'activate' ) );

        // Admin menu
        add_action( 'admin_menu', array( $this, 'add_admin_menu' ) );

        // Register REST API endpoints
        add_action( 'rest_api_init', array( $this, 'register_rest_endpoints' ) );

        // Handle CORS for development/testing
        add_action( 'init', array( $this, 'handle_cors' ) );
    }

    /**
     * Generate API key on activation if not already present.
     */
    public function activate() {
        if ( ! get_option( $this->option_key ) ) {
            $this->generate_and_save_key();
        }
    }

    /**
     * Helper to generate a secure API key.
     */
    private function generate_and_save_key() {
        $key = 'wp_conn_' . bin2hex( random_bytes( 20 ) );
        update_option( $this->option_key, $key );
        return $key;
    }

    /**
     * Add settings page in WP Admin.
     */
    public function add_admin_menu() {
        add_options_page(
            'Dashboard Connector',
            'Dashboard Connector',
            'manage_options',
            'wp-dashboard-connector',
            array( $this, 'settings_page_html' )
        );
    }

    /**
     * HTML for settings page.
     */
    public function settings_page_html() {
        if ( ! current_user_can( 'manage_options' ) ) {
            return;
        }

        // Handle key regeneration
        if ( isset( $_POST['regenerate_key'] ) && check_admin_referer( 'wp_connector_regenerate' ) ) {
            $key = $this->generate_and_save_key();
            echo '<div class="notice notice-success is-dismissible"><p>New API Key generated successfully!</p></div>';
        } else {
            $key = get_option( $this->option_key );
        }

        ?>
        <div class="wrap">
            <h1>Central Dashboard Connector Settings</h1>
            <p>Use the following credentials to connect this WordPress site to your React Central Dashboard.</p>
            
            <table class="form-table" role="presentation">
                <tbody>
                    <tr>
                        <th scope="row"><label for="site_url">Site URL</label></th>
                        <td>
                            <input name="site_url" type="text" id="site_url" value="<?php echo esc_url( site_url() ); ?>" class="regular-text" readonly onclick="this.select();">
                            <p class="description">Copy this URL to your React Dashboard site URL field.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="api_key">Secret API Key</label></th>
                        <td>
                            <input name="api_key" type="text" id="api_key" value="<?php echo esc_attr( $key ); ?>" class="large-text" readonly onclick="this.select();" style="font-family: monospace;">
                            <p class="description">Keep this key secret. Copy it into the React Dashboard to allow remote control.</p>
                        </td>
                    </tr>
                </tbody>
            </table>

            <form method="post" style="margin-top: 20px;">
                <?php wp_nonce_field( 'wp_connector_regenerate' ); ?>
                <input type="submit" name="regenerate_key" id="submit" class="button button-secondary" value="Regenerate API Key" onclick="return confirm('Regenerating the API key will disconnect the React dashboard until you update it with the new key. Are you sure?');">
            </form>
        </div>
        <?php
    }

    /**
     * Check if request is authenticated.
     */
    public function check_auth( WP_REST_Request $request ) {
        $saved_key = get_option( $this->option_key );
        if ( ! $saved_key ) {
            return false;
        }

        // Check header first, then query parameter
        $request_key = $request->get_header( 'X-WP-Connector-Key' );
        if ( ! $request_key ) {
            $request_key = $request->get_param( 'api_key' );
        }

        return hash_equals( $saved_key, (string) $request_key );
    }

    /**
     * Register REST API Endpoints.
     */
    public function register_rest_endpoints() {
        // Namespace: wp-dashboard-connector/v1
        register_rest_route( 'wp-dashboard-connector/v1', '/site-info', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array( $this, 'get_site_info' ),
            'permission_callback' => array( $this, 'check_auth' ),
        ) );

        register_rest_route( 'wp-dashboard-connector/v1', '/update-options', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array( $this, 'update_site_options' ),
            'permission_callback' => array( $this, 'check_auth' ),
        ) );

        register_rest_route( 'wp-dashboard-connector/v1', '/posts', array(
            'methods'             => WP_REST_Server::READABLE,
            'callback'            => array( $this, 'get_posts_data' ),
            'permission_callback' => array( $this, 'check_auth' ),
        ) );

        register_rest_route( 'wp-dashboard-connector/v1', '/update-post', array(
            'methods'             => WP_REST_Server::CREATABLE,
            'callback'            => array( $this, 'update_post_data' ),
            'permission_callback' => array( $this, 'check_auth' ),
        ) );
    }

    /**
     * Callback: Get Site Info and discover all editable options / fields.
     */
    public function get_site_info( WP_REST_Request $request ) {
        // Auto-detect post types
        $post_types = get_post_types( array( 'public' => true ), 'objects' );
        $formatted_post_types = array();
        foreach ( $post_types as $slug => $object ) {
            $formatted_post_types[] = array(
                'slug'  => $slug,
                'label' => $object->label,
            );
        }

        // Auto-detect some common customizable options/fields
        $fields = array(
            array( 'key' => 'blogname', 'label' => 'Site Title', 'value' => get_option( 'blogname' ), 'type' => 'text' ),
            array( 'key' => 'blogdescription', 'label' => 'Tagline', 'value' => get_option( 'blogdescription' ), 'type' => 'text' ),
            array( 'key' => 'users_can_register', 'label' => 'Membership (Anyone can register)', 'value' => get_option( 'users_can_register' ) ? true : false, 'type' => 'boolean' ),
            array( 'key' => 'default_role', 'label' => 'New User Default Role', 'value' => get_option( 'default_role' ), 'type' => 'select', 'options' => array_keys( wp_roles()->get_names() ) )
        );

        // Fetch active plugins
        $active_plugins = get_option( 'active_plugins' );
        $plugins_data = array();
        if ( ! function_exists( 'get_plugins' ) ) {
            require_once ABSPATH . 'wp-admin/includes/plugin.php';
        }
        $all_plugins = get_plugins();
        foreach ( $active_plugins as $plugin_path ) {
            if ( isset( $all_plugins[ $plugin_path ] ) ) {
                $plugins_data[] = array(
                    'name'    => $all_plugins[ $plugin_path ]['Name'],
                    'version' => $all_plugins[ $plugin_path ]['Version'],
                );
            }
        }

        return new WP_REST_Response( array(
            'site_name'    => get_option( 'blogname' ),
            'wp_version'   => get_bloginfo( 'version' ),
            'php_version'  => phpversion(),
            'post_types'   => $formatted_post_types,
            'fields'       => $fields,
            'plugins'      => $plugins_data,
            'connected_at' => current_time( 'mysql' ),
        ), 200 );
    }

    /**
     * Callback: Update specific WordPress options.
     */
    public function update_site_options( WP_REST_Request $request ) {
        $params = $request->get_json_params();
        if ( empty( $params ) ) {
            return new WP_Error( 'no_data', 'No options provided for update.', array( 'status' => 400 ) );
        }

        $allowed_options = array( 'blogname', 'blogdescription', 'users_can_register', 'default_role' );
        $updated = array();
        $failed = array();

        foreach ( $params as $key => $value ) {
            if ( in_array( $key, $allowed_options, true ) ) {
                // Sanitize boolean option
                if ( 'users_can_register' === $key ) {
                    $value = filter_var( $value, FILTER_VALIDATE_BOOLEAN ) ? '1' : '0';
                }
                
                if ( update_option( $key, $value ) ) {
                    $updated[ $key ] = $value;
                } else {
                    // update_option returns false if value didn't change or failed
                    $updated[ $key ] = $value; // Still success if value is already the same
                }
            } else {
                $failed[] = $key;
            }
        }

        return new WP_REST_Response( array(
            'success' => true,
            'updated' => $updated,
            'failed'  => $failed,
        ), 200 );
    }

    /**
     * Callback: Get posts data.
     */
    public function get_posts_data( WP_REST_Request $request ) {
        $post_type = $request->get_param( 'post_type' );
        if ( ! $post_type ) {
            $post_type = 'post';
        }

        $args = array(
            'post_type'      => $post_type,
            'posts_per_page' => -1,
            'post_status'    => 'any',
        );

        $query = new WP_Query( $args );
        $posts = array();

        if ( $query->have_posts() ) {
            while ( $query->have_posts() ) {
                $query->the_post();
                global $post;

                // Auto-detect standard post fields + custom meta fields
                $meta = get_post_meta( $post->ID );
                $clean_meta = array();
                foreach ( $meta as $key => $value ) {
                    // Filter out private meta keys (starting with underscore)
                    if ( 0 !== strpos( $key, '_' ) ) {
                        $clean_meta[ $key ] = maybe_unserialize( $value[0] );
                    }
                }

                $posts[] = array(
                    'id'         => $post->ID,
                    'title'      => get_the_title(),
                    'slug'       => $post->post_name,
                    'status'     => $post->post_status,
                    'date'       => $post->post_date,
                    'author'     => get_the_author_meta( 'display_name', $post->post_author ),
                    'content'    => get_the_content(),
                    'fields'     => $clean_meta, // Auto-detected custom metadata fields
                );
            }
            wp_reset_postdata();
        }

        return new WP_REST_Response( $posts, 200 );
    }

    /**
     * Callback: Update specific WordPress post and its custom fields.
     */
    public function update_post_data( WP_REST_Request $request ) {
        $params = $request->get_json_params();
        $post_id = isset( $params['id'] ) ? intval( $params['id'] ) : 0;

        if ( ! $post_id ) {
            return new WP_Error( 'invalid_id', 'Invalid or missing post ID.', array( 'status' => 400 ) );
        }

        // Prepare post updates
        $post_data = array(
            'ID' => $post_id,
        );

        if ( isset( $params['title'] ) ) {
            $post_data['post_title'] = sanitize_text_field( $params['title'] );
        }
        if ( isset( $params['content'] ) ) {
            $post_data['post_content'] = wp_kses_post( $params['content'] );

            // Handle Elementor content synchronization
            $old_post = get_post( $post_id );
            $old_content = $old_post ? $old_post->post_content : '';
            $new_content = $params['content'];

            $elementor_data = get_post_meta( $post_id, '_elementor_data', true );
            if ( ! empty( $elementor_data ) && $old_content !== $new_content ) {
                $old_fields = $this->extract_fields_from_content( $old_content );
                $new_fields = $this->extract_fields_from_content( $new_content );

                $replacements = array();
                if ( count( $old_fields ) === count( $new_fields ) ) {
                    for ( $i = 0; $i < count( $old_fields ); $i++ ) {
                        $replacements[] = array(
                            'old' => $old_fields[ $i ]['value'],
                            'new' => $new_fields[ $i ]['value']
                        );
                    }
                } else {
                    $old_groups = array();
                    foreach ( $old_fields as $f ) {
                        $key = $f['type'] . '_' . ( isset( $f['label'] ) ? $f['label'] : '' );
                        $old_groups[ $key ][] = $f['value'];
                    }
                    $new_groups = array();
                    foreach ( $new_fields as $f ) {
                        $key = $f['type'] . '_' . ( isset( $f['label'] ) ? $f['label'] : '' );
                        $new_groups[ $key ][] = $f['value'];
                    }

                    foreach ( $old_groups as $key => $old_vals ) {
                        if ( isset( $new_groups[ $key ] ) ) {
                            $new_vals = $new_groups[ $key ];
                            $limit = min( count( $old_vals ), count( $new_vals ) );
                            for ( $i = 0; $i < $limit; $i++ ) {
                                $replacements[] = array(
                                    'old' => $old_vals[ $i ],
                                    'new' => $new_vals[ $i ]
                                );
                            }
                        }
                    }
                }

                if ( ! empty( $replacements ) ) {
                    $is_array = is_array( $elementor_data );
                    $json_str = $is_array ? wp_json_encode( $elementor_data ) : $elementor_data;

                    foreach ( $replacements as $rep ) {
                        $old_val = $rep['old'];
                        $new_val = $rep['new'];

                        if ( $old_val !== $new_val && ! empty( $old_val ) ) {
                            $json_str = str_replace( $old_val, $new_val, $json_str );

                            $old_json_val = trim( wp_json_encode( $old_val ), '"' );
                            $new_json_val = trim( wp_json_encode( $new_val ), '"' );
                            if ( ! empty( $old_json_val ) && $old_json_val !== $old_val ) {
                                $json_str = str_replace( $old_json_val, $new_json_val, $json_str );
                            }
                        }
                    }

                    $updated_data = $is_array ? json_decode( $json_str, true ) : $json_str;
                    update_post_meta( $post_id, '_elementor_data', $updated_data );

                    // Clear Elementor CSS cache so frontend reflects changes instantly
                    if ( class_exists( '\Elementor\Plugin' ) ) {
                        if ( isset( \Elementor\Plugin::$instance->posts_css_manager ) ) {
                            \Elementor\Plugin::$instance->posts_css_manager->clear_cache();
                        }
                    }
                }
            }
        }
        if ( isset( $params['status'] ) ) {
            $post_data['post_status'] = sanitize_text_field( $params['status'] );
        }

        // Update post core fields
        $updated_id = wp_update_post( $post_data, true );
        if ( is_wp_error( $updated_id ) ) {
            return new WP_Error( 'post_update_failed', $updated_id->get_error_message(), array( 'status' => 500 ) );
        }

        // Update custom fields (meta)
        $meta_updated = array();
        if ( isset( $params['fields'] ) && is_array( $params['fields'] ) ) {
            foreach ( $params['fields'] as $key => $value ) {
                // Ensure key is not private/reserved (doesn't start with underscore)
                if ( 0 !== strpos( $key, '_' ) ) {
                    if ( is_array( $value ) ) {
                        update_post_meta( $post_id, $key, $value );
                    } else {
                        update_post_meta( $post_id, $key, sanitize_text_field( $value ) );
                    }
                    $meta_updated[] = $key;
                }
            }
        }

        return new WP_REST_Response( array(
            'success'      => true,
            'post_id'      => $post_id,
            'meta_updated' => $meta_updated,
        ), 200 );
    }

    /**
     * Helper to extract content fields from HTML content (mirror of React logic).
     */
    private function extract_fields_from_content( $content ) {
        $fields = array();
        if ( empty( $content ) ) {
            return $fields;
        }

        // 1. Extract buttons/links
        if ( preg_match_all( '/<a\s+[^>]*href=["\']([^"\']*)["\'][^>]*>(.*?)<\/a>/is', $content, $matches, PREG_SET_ORDER ) ) {
            foreach ( $matches as $match ) {
                $url = $match[1];
                $text = trim( strip_tags( $match[2] ) );
                $fields[] = array(
                    'type' => 'button_url',
                    'value' => $url,
                );
                $fields[] = array(
                    'type' => 'button_text',
                    'value' => $text,
                );
            }
        }

        // 2. Extract images
        if ( preg_match_all( '/<img\s+[^>]*src=["\']([^"\']*)["\']/is', $content, $matches, PREG_SET_ORDER ) ) {
            foreach ( $matches as $match ) {
                $fields[] = array(
                    'type' => 'image',
                    'value' => $match[1],
                );
            }
        }

        // 3. Extract videos
        if ( preg_match_all( '/<iframe\s+[^>]*src=["\']([^"\']*)["\']/is', $content, $matches, PREG_SET_ORDER ) ) {
            foreach ( $matches as $match ) {
                $fields[] = array(
                    'type' => 'video',
                    'value' => $match[1],
                );
            }
        }

        // 4. Extract custom key-value text blocks
        $text_labels = array(
            'Workshop Date', 'Workshop Price', 'CTA Links', 'Videos', 'Images',
            'Date', 'Price', 'Schedule', 'Location', 'Venue', 'Time'
        );
        foreach ( $text_labels as $label ) {
            // Newline format
            $regex_nl = '/' . preg_quote( $label, '/' ) . '\s*[\r\n]+\s*([^<\r\n]+)/i';
            if ( preg_match_all( $regex_nl, $content, $matches, PREG_SET_ORDER ) ) {
                foreach ( $matches as $match ) {
                    $fields[] = array(
                        'type' => 'text_block',
                        'label' => $label,
                        'value' => trim( $match[1] ),
                    );
                }
            }
            // Colon format
            $regex_col = '/' . preg_quote( $label, '/' ) . '\s*:\s*([^<\r\n]+)/i';
            if ( preg_match_all( $regex_col, $content, $matches, PREG_SET_ORDER ) ) {
                foreach ( $matches as $match ) {
                    $fields[] = array(
                        'type' => 'text_block',
                        'label' => $label,
                        'value' => trim( $match[1] ),
                    );
                }
            }
        }

        return $fields;
    }

    /**
     * Handle CORS preflight and headers for external React dashboard.
     */
    public function handle_cors() {
        if ( isset( $_SERVER['REQUEST_URI'] ) && strpos( $_SERVER['REQUEST_URI'], 'wp-json/wp-dashboard-connector' ) !== false ) {
            header( 'Access-Control-Allow-Origin: *' );
            header( 'Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE' );
            header( 'Access-Control-Allow-Headers: X-WP-Connector-Key, Content-Type, Authorization, Origin, X-Requested-With' );
            
            // Handle preflight OPTIONS request
            if ( isset( $_SERVER['REQUEST_METHOD'] ) && 'OPTIONS' === $_SERVER['REQUEST_METHOD'] ) {
                status_header( 200 );
                exit;
            }
        }
    }
}

new WP_Dashboard_Connector();
