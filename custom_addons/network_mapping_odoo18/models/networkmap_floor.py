from odoo import _, api, fields, models
from odoo.exceptions import UserError
import logging
_logger = logging.getLogger(__name__)


class NetworkMapFloor(models.Model):
    _name = 'network.map.floor'
    _description = 'Patch Floors / Locations'
    _order = 'name'

    name = fields.Char(required=True, index=True)
    code = fields.Char(help="Optional code for the floor (e.g., 6th Floor, 9th Floor).")

    _sql_constraints = [
        ('uniq_floor_name', 'unique(name)', 'Floor name must be unique.'),
    ]
