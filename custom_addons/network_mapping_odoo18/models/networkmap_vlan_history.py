# -*- coding: utf-8 -*-
from odoo import api, models, fields

class NetworkMapVlanHistory(models.Model):
    _name = 'network.map.vlan.history'
    _description = 'VLAN Change History'
    _order = 'date_added desc'

    port_id = fields.Many2one('network.map.port', string='Port', ondelete='cascade')
    vlan_id = fields.Char(string='VLAN ID')
    user_name = fields.Char(string='Changed By')
    date_added = fields.Datetime(string='Date', default=fields.Datetime.now)