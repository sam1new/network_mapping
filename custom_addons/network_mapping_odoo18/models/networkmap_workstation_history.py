# -*- coding: utf-8 -*-
from odoo import models, fields, api

class NetworkMapWorkstationHistory(models.Model):
    _name = 'network.map.workstation.history'
    _description = 'Workstation Info History'
    _order = 'date_added desc, id desc' 

    port_id = fields.Many2one('network.map.port', required=True, ondelete='cascade')
    assigned_user = fields.Char()
    department = fields.Char()
    date_added = fields.Datetime(required=True)
    date_replaced = fields.Datetime()
