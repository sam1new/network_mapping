# -*- coding: utf-8 -*-
from odoo import models, fields, api
from odoo import _


class NetworkMapPort(models.Model):
    _name = 'network.map.port'
    _description = 'Patch Quest Ports'
    _order = 'panel_id, port_number'

    # ----------------------------
    # Workstation tracking fields
    # ----------------------------
    workstation_history_ids = fields.One2many(
        'network.map.workstation.history',
        'port_id',
        string='Workstation History',
    )
    workstation_effective_from = fields.Datetime(
        string='Workstation Effective From',
        readonly=True,
        help="When the current (assigned_user, department) combo became active.",
    )

    # ----------------------------
    # Comments 
    # ----------------------------

    comment_ids = fields.One2many(
        'network.map.comment',
        'port_id',
        string="Port History Logs"
    )

    
    general_comment_ids = fields.One2many(
        'network.map.comment', 'port_id',
        string="Activity Logs",
    )

    # ----------------------------
    # Port identity & status
    # ----------------------------
    port_number = fields.Selection(selection=[(str(i), str(i)) for i in range(1, 49)], string="Port Number",required=True, default='1')

    # Use a plain Char field (no compute) so manual values are preserved.
    full_port_name = fields.Char(string='Port Label', index=True)

    # Marks if the label was manually set by a user; used to avoid overwriting.
    is_label_manual = fields.Boolean(string="Manual Label", default=False)

    ip_address = fields.Char(string='IP Address')
    vlan_id = fields.Char(string='VLAN ID')

    comments = fields.Text(string='Comment Summary', compute='_compute_comments_text')

    panel_id = fields.Many2one(
        'patch.panel',
        string='Network Panel',
        required=True,
        ondelete='cascade'
    )
    status = fields.Selection(
        [('free', 'Free'), ('used', 'Used')],
        string='Status',
        compute='_compute_status',
        store=True,
        default='free'
    )

    desktop_ip = fields.Char(string="Desktop IP")
    hostname = fields.Char(string="Hostname")

    assigned_user = fields.Char(string="Assigned User")
    department = fields.Char(string="Department")

    employee_id = fields.Many2one('hr.employee', string="Assigned Employee")

    department_name = fields.Char(
        related='employee_id.department_id.name',
        string="Department Name",
        store=False
    )

    _sql_constraints = [
        ('port_number_unique_per_panel', 'unique(panel_id, port_number)',
         'The port number must be unique within the same panel!'),
    ]

    # ----------------------------
    # Status & Comments computes
    # ----------------------------
    @api.depends('assigned_user')
    def _compute_status(self):
        for port in self:
            port.status = 'used' if port.assigned_user else 'free'

    @api.depends('comment_ids', 'comment_ids.comment_text', 'comment_ids.category')
    def _compute_comments_text(self):
        for port in self:
            port.comments = ""
            texts = []
            general_comments = port.comment_ids.filtered(lambda c: c.category == 'general')
            for c in general_comments.sorted('date'):
                user = c.user_name or 'Unknown'
                date_str = ""
                if c.date:
                    date_str = c.date.strftime('%Y-%m-%d %H:%M')
                text = (c.comment_text or '').strip()
                if text:
                    texts.append(f"[{date_str}] {user}: {text}")
            if texts:
                port.comments = "\n".join(texts)

    # ----------------------------
    # Create / Write overrides
    # ----------------------------
    @api.model_create_multi
    def create(self, vals_list):
        now = fields.Datetime.now()
        # Set timestamp in vals_list before creation for efficiency
        for vals in vals_list:
            if vals.get('assigned_user') or vals.get('department'):
                vals['workstation_effective_from'] = now

        records = super().create(vals_list)
        
        History = self.env['network.map.workstation.history']
        history_vals = []
        for rec in records:
            if rec.assigned_user or rec.department:
                history_vals.append({
                    'port_id': rec.id,
                    'assigned_user': rec.assigned_user,
                    'department': rec.department,
                    'date_added': now,
                })
        
        if history_vals:
            History.create(history_vals)
            
        return records

    def write(self, vals):
        tracked_fields = {
            'full_port_name': 'Port Number',
            'vlan_id': 'VLAN ID',
            'assigned_user': 'Employee',
            'department': 'Department'
        }

        # Log field changes to comments
        all_logs = []
        for record in self:
            for field, label in tracked_fields.items():
                if field in vals:
                    old_val = str(getattr(record, field) or "None")
                    new_val = str(vals[field] or "None")
                    if old_val != new_val:
                        all_logs.append({
                            'port_id': record.id,
                            'user_id': self.env.uid,
                            'user_name': self.env.user.name,
                            'date': fields.Datetime.now(),
                            'comment_text': f"{label} changed from '{old_val}' to '{new_val}'",
                            'category': 'general',
                            'field_name': field,
                        })
        if all_logs:
            self.env['network.map.comment'].create(all_logs)

        # Handle Workstation History and Timestamp Refresh
        if 'assigned_user' in vals or 'department' in vals:
            now = fields.Datetime.now()
            # Update the effective date directly in the vals to be written
            vals['workstation_effective_from'] = now
            
            History = self.env['network.map.workstation.history']
            
            # Close old entries and prep new ones
            for rec in self:
                # Check if values actually changed to avoid redundant history
                if (vals.get('assigned_user') != rec.assigned_user or 
                    vals.get('department') != rec.department):
                    
                    # Close previous open entry
                    prev = History.search([('port_id', '=', rec.id), ('date_replaced', '=', False)], limit=1)
                    if prev:
                        prev.write({'date_replaced': now})
                    
                    # Create new entry if fields are not just being cleared
                    if vals.get('assigned_user') or vals.get('department'):
                        History.create({
                            'port_id': rec.id,
                            'assigned_user': vals.get('assigned_user', rec.assigned_user),
                            'department': vals.get('department', rec.department),
                            'date_added': now,
                        })
        
        return super().write(vals)
   
    @api.model
    def update_port_data_rpc(self, port_id, vals):
        port = self.browse(port_id)
        if not port.exists():
            return {'success': False, 'error': 'Port not found'}

        if 'comment_ids' in vals and isinstance(vals['comment_ids'], list):
            for command in vals['comment_ids']:
                if isinstance(command, (list, tuple)) and command[0] == 0:
                    data = command[2]
                    if not data.get('category'):
                        data['category'] = 'general'
                        
                    date_val = data.get('date')
                    if date_val and 'T' in date_val:    
                        data['date'] = date_val.replace('T', ' ') + ':00'
                    if not (data.get('user_name') or '').strip():
                        data['user_name'] = self.env.user.name
                    if not data.get('user_id'):
                        data['user_id'] = self.env.uid

        update_vals = {}

        field_mapping = {
            'vlan_id': 'vlan_id',
            'assigned_user': 'assigned_user',
            'department': 'department',
            'comment_ids' : 'comment_ids',
            'full_port_name': 'full_port_name',
            'new_full_port_name': 'full_port_name',
        }
    
        for incoming_key, backend_field in field_mapping.items():
            if incoming_key in vals:
                val = vals[incoming_key]
                if isinstance(val,str):
                    update_vals[backend_field] = val.strip()
                else:
                    update_vals[backend_field] = val

        if update_vals:
            port.write(update_vals)

        general_has = any(
            (c.category == 'general') and not getattr(c, 'is_hidden_in_ui', False)
            for c in port.comment_ids
        )
        vlan_has = any(
            (c.category == 'vlan') and not getattr(c, 'is_hidden_in_ui', False)
            for c in port.comment_ids
        )

        response_data = {
            "vlan_id": port.vlan_id or "",
            "assigned_user": port.assigned_user or "",
            "department": port.department or "",
            "status": port.status,
            "full_port_name": port.full_port_name or "",
            "has_general_comment": general_has,
            "has_vlan_comment": vlan_has,
            "comment_ids": self._prepare_comment_data(port.comment_ids),
        }

        self._send_panel_event(port, "port:update", response_data)

        return{**response_data, 'success': True, 'has_comment': general_has}


    @api.model
    def get_current_user_name(self):
        return self.env.user.name or ""
    
    @api.model
    def get_port_comments_rpc(self, port_id):
        """
        Fetch port comments with computed can_edit permissions.
        Returns list of comments with can_edit flag for authorization.
        """
        port = self.browse(port_id)
        if not port.exists():
            return {'success': False, 'error': 'Port not found'}
        
        # Get only visible general comments, ordered by date descending
        comments = port.comment_ids.filtered(
            lambda c: c.category == 'general' and not c.is_hidden_in_ui
        ).sorted('date', reverse=True)
        
        return {
            'success': True,
            'comments': self._prepare_comment_data(comments)
        }
    
    def get_workstation_history_rpc(self, port_id, limit=3, offset=0):
        """
        Return workstation history rows for a port, newest first.

        """
        port = self.browse(port_id)
        if not port.exists():
            return {'success': False, 'error': 'Port not found'}
        
        History = self.env['network.map.workstation.history']
        order = 'date_added desc, id desc'

        def _fmt(dt):
            return fields.Datetime.to_string(dt) if dt else False
        
        
        cur_user = (port.assigned_user or '').strip()
        cur_dept = (port.department or '').strip()
        has_current = bool(cur_user or cur_dept)
        current_date = port.workstation_effective_from or port.create_date or fields.Datetime.now()
        current_date_s = _fmt(current_date)

        try:
            limit = int(limit)
        except Exception:
            limit =3
        need_hist = max (0, limit - (1 if has_current else 0))
        
        fetch_limit = need_hist + 1 if need_hist else 0
        
        hist_domain = [('port_id', '=', port_id)]
        rows = History.search(hist_domain, order=order, limit=fetch_limit, offset=offset)

        data = [{
            'id': r.id,
            'assigned_user': (r.assigned_user or '').strip(),
            'department': (r.department or '').strip(),
            'date_added': _fmt(r.date_added),
            'date_replaced': _fmt(r.date_replaced),
        } for r in rows]

       
        if has_current and data:
            top = data[0]
            if (top.get('assigned_user') == cur_user and
                top.get('department') == cur_dept and
                top.get('date_added') == current_date_s and
                top.get('date_replaced') == current_date_s):
                data = data[1:]  # drop duplicate

        data = data[:need_hist]
        
        payload = {
            'success': True,
            'total': History.search_count([('port_id', '=', port_id)]),
            'rows': data,
            'current': {
                'assigned_user': cur_user,
                'department': cur_dept,
                'effective_from': current_date_s,
            }
        }

        if has_current:
            current_row = {
                'id': 0,
                'assigned_user': cur_user,
                'department' : cur_dept,
                'date_added': current_date_s,
                'date_replaced': False,
            }
            payload['rows'] = [current_row] + payload['rows']
        return payload

   
    def _prepare_comment_data(self, comments):
        is_admin = self.env.user.has_group('base.group_system')
        uid = self.env.uid

        return [{
            'id': c.id,
            'user_name': c.user_name,
            'comment_text': c.comment_text,
            'date': fields.Datetime.to_string(c.date),
            'category': c.category,
            'field_name': getattr(c, 'field_name', 'comment_text'),   
            'can_edit': (
            is_admin or
            (c.user_id and c.user_id.id == uid)
        ),
        } for c in comments]

    @api.model
    def create_port_rpc(self,panel_id,port_num,vals):
        panel= self.env['patch.panel'].browse(panel_id)
        if not panel.exists():
            return {'success':False, 'error': 'Panel not found.'}

        
        if 'comment_ids' in vals and isinstance(vals['comment_ids'], list):
            for command in vals['comment_ids']:
                if isinstance(command, (list, tuple)) and command[0] == 0:
                    data = command[2]
                    date_val = data.get('date')
                    if date_val and isinstance(date_val, str) and 'T' in date_val:
                        # Convert "YYYY-MM-DDTHH:MM" -> "YYYY-MM-DD HH:MM:SS"
                        data['date'] = date_val.replace('T', ' ') + ':00'
                    # Always stamp author from current user for correctness
                    data['user_name'] = self.env.user.name
                    data['user_id'] = self.env.uid

        create_vals = {
            'panel_id': panel_id,
            'port_number': str(port_num),
            'full_port_name': (vals.get('new_full_port_name') or '').strip(),
            'vlan_id': (vals.get('vlan_id') or '').strip(),
            'assigned_user': (vals.get('assigned_user') or '').strip(),
            'department': (vals.get('department') or '').strip(),
        }

        
        if vals.get('comment_ids'):
            create_vals['comment_ids'] = vals['comment_ids']

        port = self.create(create_vals)

        general_has = any(
            (c.category == 'general') and not getattr(c, 'is_hidden_in_ui', False)
            for c in port.comment_ids
        )
        vlan_has = any(
            (c.category == 'vlan') and not getattr(c, 'is_hidden_in_ui', False)
            for c in port.comment_ids
        )

        self._send_panel_event(port, "port:create", {
            "vlan_id": port.vlan_id,
            "assigned_user": port.assigned_user or "",
            "department": port.department or "",
            "status": port.status,
            "full_port_name": port.full_port_name,
            "has_general_comment": general_has,
            "has_vlan_comment":vlan_has,
            "comment_ids": self._prepare_comment_data(port.comment_ids),
        })

        return {
            'success': True,
            'id': port.id,
            'status': port.status,
            'has_comment': general_has,
            'has_general_comment': general_has,
            'has_vlan_comment': vlan_has,
            'new_full_port_name': port.full_port_name or "",
            'comment_ids': self._prepare_comment_data(port.comment_ids),
            'vlan_id': port.vlan_id,
            'assigned_user': port.assigned_user or "",
            'department': port.department or "",
        }
    
    def _send_panel_event(self, rec, event, data=None):
        try:
            channel_string = f"network_map:panel:{rec.panel_id.id}"
            payload = {
                "model": "network.map.port",
                "event": event,  # "port:update" | "port:create"
                "panel_id": rec.panel_id.id,
                "port_id": rec.id,
                "port_number": rec.port_number,
                "data": data or {},
            }
            bus = self.env["bus.bus"]

            # Variant A (most compatible on many Odoo builds):
            # _sendone( [ ((dbname, channel), payload) ] )
            dbch = (self._cr.dbname, channel_string)
            notifications = [(dbch, payload)]
            try:
                bus._sendone(notifications)
                return
            except TypeError:
                # Fall through to other shapes
                pass

            # Variant B: _sendone(channel_string, payload)
            try:
                bus._sendone(channel_string, payload)
                return
            except Exception:
                pass

            # Variant C (public API on some builds): sendone(channel_string, payload)
            try:
                bus.sendone(channel_string, payload)
                return
            except Exception:
                pass
        except Exception:
            # Never block/raise on bus issues. Real-time is best-effort.
            return
        
        
 # ----------------------------
    # Helpers used by workstation RPCs
    # ----------------------------
    @api.model
    def _parse_incoming_datetime(self, s):
        """Accept 'YYYY-MM-DDTHH:MM' or 'YYYY-MM-DD HH:MM[:SS]' and return a datetime or False."""
        if not s:
            return False
        s = str(s).strip()
        # normalize
        if 'T' in s:
            s = s.replace('T', ' ')
        if len(s) == 16:  # 'YYYY-MM-DD HH:MM' => add seconds
            s = s + ':00'
        try:
            return fields.Datetime.from_string(s)
        except Exception:
            return False

 

    @api.model
    def get_vlan_history_rpc(self, port_id):
   
        history_recs = self.env['network.map.vlan.history'].search([
            ('port_id', '=', port_id)
        ], order='date_added desc', limit=10)
       
        return [{
            'id': h.id,
            'user_name': h.user_name,
            'date': h.date_added,
            'comment_text': f"Changed VLAN to: {h.vlan_id}", 
            'category': 'vlan'
        } for h in history_recs]

    @api.model
    def get_vlan_indicators_batch(self, port_ids):
        if not port_ids:
            return {}

        vlan_comments = self.env['network.map.comment'].search_read(
            [('port_id', 'in', port_ids), ('field_name', '=', 'vlan_id')],
            ['port_id'],
            limit=None
        )

        ports_with_vlan = {row['port_id'][0] for row in vlan_comments}
        
        return {p_id: (p_id in ports_with_vlan) for p_id in port_ids}
    
    @api.model
    def get_field_history_rpc(self, port_id, limit=20):
        """
        Returns history for a specific port. 
        Strictly filters for 'vlan_id' changes to ensure the VLAN modal is accurate.
        """
        try:
            limit = int(limit) if not isinstance(limit, list) else 20
        except (ValueError, TypeError):
            limit = 20

        port = self.browse(port_id)
        if not port.exists():
            return {'success': False, 'error': 'Port not found'}


        domain = [
            ('port_id', '=', port.id),
            ('is_hidden_in_ui', '=', False),
            ('field_name', '=', 'vlan_id') 
        ]

        comments = self.env['network.map.comment'].search_read(
            domain=domain, 
            fields=['id', 'user_name', 'date', 'comment_text', 'category', 'field_name'],
            order='date DESC',
            limit=limit
        )

        history_data = []
        for c in comments:
            history_data.append({
                'id': f"comment_{c['id']}",
                'user_name': c.get('user_name') or 'System',
                'date': fields.Datetime.to_string(c.get('date')),
                'comment_text': c.get('comment_text'),
                'category': 'vlan', # Force category to vlan for the UI's CSS/Icon logic
                'field_name': 'vlan_id',
            })

        # Note: If you still use the 'network.map.vlan.history' table, 
        # we keep this part to merge those records as well.
        vlan_recs = self.env['network.map.vlan.history'].search([
            ('port_id', '=', port_id)
        ], order='date_added desc', limit=limit)

        for v in vlan_recs:
            history_data.append({
                'id': f"vlan_{v.id}",
                'user_name': v.user_name or 'System',
                'date': fields.Datetime.to_string(v.date_added),
                'comment_text': f"VLAN updated to: {v.vlan_id}",
                'category': 'vlan',
            })

        # Final sort to ensure the merge of the two tables is chronological
        history_data.sort(key=lambda x: x['date'] or '', reverse=True)
        
        return {
            'success': True,
            'history': history_data[:limit]
        }

    @api.model
    def get_recent_system_activity_rpc(self, port_id, limit=20):
        port = self.browse(port_id)
        if not port.exists():
            return {'success': False, 'error': 'Port not found'}

        # FILTER: Only include Port Name changes, VLAN changes
        domain = [
        ('port_id', '=', port.id),
        ('is_hidden_in_ui', '=', False),
        ('field_name', 'in', ['full_port_name', 'vlan_id'])
    ]

        logs = self.env['network.map.comment'].search(domain, order='date desc', limit=limit)

        return {
            'success': True,
            'activity': [{
                'id': log.id,
                'user_name': log.user_name or 'System', 
                'date': fields.Datetime.to_string(log.date),
                'comment_text': log.comment_text,        
                'field_name': log.field_name or '',    
                'category': log.category or 'general',
            } for log in logs]
        }

    @api.model
    def get_recent_workstation_activity_rpc(self, port_id, limit=20):
        """
        Fetches history specifically for assigned_user and department.

        """
        port = self.browse(port_id)
        if not port.exists():
            return {'success': False, 'error': 'Port not found'}

        domain = [
            ('port_id', '=', port.id),
            ('is_hidden_in_ui', '=', False),
            ('field_name', 'in', ['assigned_user', 'department'])
        ]
        
        logs = self.env['network.map.comment'].search_read(
            domain=domain,
            fields=['id', 'user_name', 'date', 'comment_text', 'field_name'],
            order='date DESC',
            limit=limit
        )

        history_data = []
        for l in logs:
            history_data.append({
                'id': f"log_{l['id']}",
                'user_name': l.get('user_name') or 'System',
                'date': fields.Datetime.to_string(l.get('date')),
                'comment_text': l.get('comment_text'),
                'field_name': l.get('field_name'),
                'category': 'workstation',
            })
        
        return {
            'success': True,
            'activity': history_data[:limit]
        }



            
