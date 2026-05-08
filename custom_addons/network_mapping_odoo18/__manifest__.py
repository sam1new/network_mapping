{
    'name' : 'Network Mapping',
    'description' : 'Network Mapping System for HD.',
    'sequence' : -1,
    'category' : 'DevOps',
    'depends' : [ 'base', 'bus', 'hr'],
    'data' : [
        'security/ir.model.access.csv',
        'security/security.xml',

        'data/networkmap_data.xml',

        'views/sixth_floor_panel_views.xml',
        'views/ninth_floor_panel_views.xml',
        'views/tenth_floor_panel_views.xml',
        'views/sixteenth_floor_panel_views.xml',
        'views/patch_panel_list_views.xml',
        'views/menu_items.xml',
    ],
    'demo' : [],
    'installable' : True,
    'application' : True,
    'icon': '/network_mapping_odoo18/static/description/iconv2.png',    
    'assets' : {
        'web.assets_backend': [
            'network_mapping_odoo18/static/src/scss/variables.scss',

            'network_mapping_odoo18/static/src/scss/networkmap_dark_mode_port_modal.scss',
            'network_mapping_odoo18/static/src/scss/networkmap_light_mode_port_modal.scss',

            'network_mapping_odoo18/static/src/scss/networkmap_light_mode_panel_modal.scss',
            'network_mapping_odoo18/static/src/scss/networkmap_dark_mode_panel_modal.scss',

            'network_mapping_odoo18/static/src/scss/networkmap_dark_mode_main.scss',
            'network_mapping_odoo18/static/src/scss/networkmap_light_mode_main.scss',

            'network_mapping_odoo18/static/src/scss/networkmap_dark_mode_confirmation_dialog.scss',
            'network_mapping_odoo18/static/src/scss/networkmap_light_mode_confirmation_dialog.scss',
            
            'network_mapping_odoo18/static/src/components/networkmap_main.xml',
            'network_mapping_odoo18/static/src/components/networkmap_port_modal.xml',
            'network_mapping_odoo18/static/src/components/networkmap_vlan_modal.xml',
            'network_mapping_odoo18/static/src/components/networkmap_panel_modal.xml',

            

            'network_mapping_odoo18/static/src/components/networkmap_port_modal.js',
            
            'network_mapping_odoo18/static/src/components/networkmap_vlan_modal.js',
           
            'network_mapping_odoo18/static/src/components/networkmap_panel_modal.js',
            'network_mapping_odoo18/static/src/components/networkmap_main.js',
            
        ],
    },
    'license' : 'LGPL-3',
}
