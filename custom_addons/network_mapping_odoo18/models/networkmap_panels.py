from psycopg2 import IntegrityError
from odoo import _, api, fields, models
from odoo.exceptions import UserError
import logging

_logger = logging.getLogger(__name__)


class PatchPanel(models.Model):
    _name = 'patch.panel'
    _description = 'Patch Quest Panels'
    _order = 'cabinet_id, panel_number'

    name = fields.Char(string='Panel Name', required=True)
    floor_id = fields.Many2one(
        'network.map.floor',
        string='Floor/Location',
        required=True,
        index=True
    )
    cabinet_id = fields.Many2one(
        'network.map.cabinet',
        string='Cabinet/Rack',
        required=True,
        domain="[('floor_id', '=', floor_id)]",
        index=True
    )
    panel_number = fields.Integer(string='Panel Number', required=True, default=1)
    ip_address = fields.Char(string='IP Address')
    device_type = fields.Char(string='Device Type')
    serial_number = fields.Char(string='Serial Number')
    port_ids = fields.One2many(
        'network.map.port',
        'panel_id',
        string='Ports',
        help="List of all ports on this panel. Default is 48.",
        ondelete='cascade'
    )

    port_count = fields.Selection(
    [
        ('24', '24 Ports'),
        ('48', '48 Ports'),
    ],
    string='Port Count',
    required=True,
    default='48',
    help="Select how many ports this patch panel has."
)

    _sql_constraints = [
        # Uniqueness per cabinet
        ('uniq_cabinet_panel_number', 'unique(cabinet_id, panel_number)',
         'This panel number already exists in the selected cabinet.'),
        ('uniq_cabinet_name', 'unique(cabinet_id, name)',
         'Panel name must be unique within the selected cabinet.'),
    ]

    # --- Helpers ---

    def _get_next_panel_number(self, cabinet_id):
        """Return next panel_number within a cabinet inside current transaction."""
        self.env.cr.execute("""
            SELECT COALESCE(MAX(panel_number), 0) FROM patch_panel
            WHERE cabinet_id = %s
        """, (cabinet_id,))
        (max_num,) = self.env.cr.fetchone()
        return (max_num or 0) + 1

    def _build_default_name(self):
        """Build a default name based on floor, cabinet and panel number."""
        self.ensure_one()
        flr = self.floor_id.name or ''
        cab = self.cabinet_id.name or ''
        num = self.panel_number or 0
        # Adjust the pattern to what you prefer
        return f"{flr}/{cab} - Panel {num}"

    @api.model
    def _build_default_name_from_vals(self, vals):
        """
        Build default name using provided vals (used pre-create when name is missing).
        Requires floor_id, cabinet_id, panel_number in vals.
        """
        floor_name = ''
        cabinet_name = ''
        num = vals.get('panel_number') or 0

        floor_id = vals.get('floor_id')
        if floor_id:
    
            floor = self.env['network.map.floor'].browse(floor_id)
            floor_name = floor.name or ''

        cabinet_id = vals.get('cabinet_id')
        if cabinet_id:
            cab = self.env['network.map.cabinet'].browse(cabinet_id)
            cabinet_name = cab.name or ''

        return f"{floor_name}/{cabinet_name} - Panel {num}"

    def _broadcast_changes(self):
        """(Your existing real-time bus) Updated to use relational fields."""
        try:
            if 'bus.bus' in self.env.registry:
                self.env['bus.bus']._sendone('patch_quest_channel', 'patch_quest_notification', {
                    'type': 'reload_data',
                    'floor': self.floor_id.name if self.floor_id else False,
                    'cabinet': self.cabinet_id.name if self.cabinet_id else False,
                })
        except Exception as e:
            _logger.warning("Could not broadcast change: %s", e)

    def write(self, vals):
        res = super().write(vals)
        if any(f in vals for f in ['ip_address', 'device_type', 'serial_number']):
            self._broadcast_changes()
        return res

    # Auto-fill next panel_number + name when floor/cabinet picked (UI experience)
    @api.onchange('floor_id', 'cabinet_id')
    def _onchange_location_set_defaults(self):
        for rec in self:
            if not rec.cabinet_id:
                continue

            # Find the current maximum panel_number within this cabinet
            last = self.search(
                [('cabinet_id', '=', rec.cabinet_id.id)],
                order='panel_number desc', limit=1
            )
            next_num = (last.panel_number + 1) if last else 1

            # If panel_number not set or cabinet changed, suggest next
            # (use rec._origin to detect change from original value)
            cabinet_changed = bool(rec._origin) and (rec._origin.cabinet_id != rec.cabinet_id)
            if not rec.panel_number or cabinet_changed:
                rec.panel_number = next_num

            # Prefill name if empty or if cabinet changed
            if not rec.name or cabinet_changed:
                rec.name = rec._build_default_name()

    # Concurrency-safe create: assign next panel_number per cabinet and retry on collisions
    @api.model_create_multi
    def create(self, vals_list):
        # Prepare a working copy to avoid mutating the original input
        to_create = []
        auto_name_flags = []  # Track which ones we auto-named, to recompute on retries

        for vals in vals_list:
            vals = dict(vals)  # shallow copy

            cab_id = vals.get('cabinet_id')
            # Assign next panel_number if absent or falsy (0/False)
            if cab_id and not vals.get('panel_number'):
                vals['panel_number'] = self._get_next_panel_number(cab_id)

            # If no name provided, build a default *before* create (required=True)
            auto_name = False
            if not vals.get('name'):
                vals['name'] = self._build_default_name_from_vals(vals)
                auto_name = True

            to_create.append(vals)
            auto_name_flags.append(auto_name)

        tries = 0
        panels = self.env['patch.panel']

        while tries < 5:
            try:
                with self.env.cr.savepoint():
                    panels = super().create(to_create)
                break
            except IntegrityError:
                tries += 1
                _logger.info("Collision detected in patch.panel. Retry attempt: %s", tries)

                if tries >= 5:
                    raise UserError(_("Could not assign a unique panel number after several attempts."))
                
                for i, vlas in enumerate(to_create):
                    cab_id = vals.get('cabinet_id')
                    if cab_id:
                        vals['panel_number'] = self._get_next_panel_number(cab_id)
                        if auto_name_flags[i]:
                            vals['name'] = self._build_default_name_from_vals(vals)

    
        for panel in panels:
            if not panel.port_ids:
                count = int(panel.port_count or 48)
                port_data = [{'panel_id': panel.id, 'port_number': str(i)} for i in range(1, count + 1)]
                self.env['network.map.port'].create(port_data)

        return panels

    @api.model
    def write_panel_device_info(self, panel_id, payload):
        panel = self.browse(panel_id)
        if not panel.exists():
            raise UserError(_("Patch Panel not found."))

        panel.write({
            'ip_address': (payload.get('ip') or "").strip() or False,
            'device_type': (payload.get('type') or "").strip() or False,
            'serial_number': (payload.get('serial') or "").strip() or False,
        })
        return {'success': True, 'panel_id': panel_id}

    @api.model
    def get_cabinet_panel_data(self, floor, cabinet):
        """
        Backwards-compatible: 'floor' and 'cabinet' are names (case-insensitive).
        """
        panels = self.search([
            ('floor_id.name', '=ilike', floor),
            ('cabinet_id.name', '=ilike', cabinet),
        ], order='panel_number asc')

        if not panels:
            _logger.warning(
                "No panels found for floor='%s' cabinet='%s'. Check if the location exists and spelling/case matches.",
                floor, cabinet
            )
            return []

        result = []
        for panel in panels:
            port_map = []
            for port in panel.port_ids.sorted('port_number'):
                general_has = any(
                    (c.category or 'general') == 'general' and not getattr(c, 'is_hidden_in_ui', False)
                    for c in port.comment_ids
                )
                vlan_has = any(
                    (c.category or 'vlan') == 'vlan' and not getattr(c, 'is_hidden_in_ui', False)
                    for c in port.comment_ids
                )
                port_map.append({
                    "id": port.id,
                    "num": port.port_number,
                    "label": port.full_port_name,
                    "status": port.status,
                    "has_comment": general_has,
                    "has_vlan_comment": vlan_has,
                    "vlan_id": port.vlan_id or "",
                    "assigned_user": port.assigned_user or "",
                    "department": port.department or "",
                    "desktop_ip": port.desktop_ip or "",
                    "hostname": port.hostname or "",
                })

            result.append({
                "id": panel.id,
                "name": panel.name,
                "port_count": int(panel.port_count),
                "port_map": port_map,
                "device": {
                    "id": panel.id,
                    "ip": panel.ip_address or "",
                    "type": panel.device_type or "",
                    "serial": panel.serial_number or "",
                },
            })
        return result

    @api.model
    def get_device_info_rpc(self, panel_id):
        """
        Retrieves device info (IP, Type, Serial) for a patch panel.
        Requires read access to patch.panel model.
        """
        panel = self.browse(panel_id)
        if not panel.exists():
            return {'success': False, 'error': 'Panel not found'}
        
        return {
            'success': True,
            'ip': panel.ip_address or "",
            'type': panel.device_type or "",
            'serial': panel.serial_number or "",
        }

    def _prepare_comment_data(self, comments):
        return [{
            'id': c.id,
            'user_name': c.user_name,
            'comment_text': c.comment_text,
            'date': c.date.strftime('%Y-%m-%d %H:%M:%S') if c.date else '',
            'category': c.category,
        } for c in comments]