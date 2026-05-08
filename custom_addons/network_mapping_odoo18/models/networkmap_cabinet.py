
from odoo import _, api, fields, models
from odoo.exceptions import UserError
import logging
_logger = logging.getLogger(__name__)


class NetworkMapCabinet(models.Model):
    _name = 'network.map.cabinet'
    _description = 'Patch Cabinets / Racks'
    _order = 'floor_id, name'

    name = fields.Char(required=True)
    floor_id = fields.Many2one('network.map.floor', required=True, ondelete='restrict', index=True)

    _sql_constraints = [
        ('uniq_floor_cabinet', 'unique(floor_id, name)',
         'Cabinet/Rack name must be unique per floor.'),
    ]
