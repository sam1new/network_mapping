from odoo import models, fields, api

class NetworkMapComment(models.Model):
    _name = 'network.map.comment'
    _description = 'Internal storage for port comments'
    
    port_id = fields.Many2one('network.map.port')
    user_id = fields.Many2one('res.users', string='Author')
    user_name = fields.Char()
    comment_text = fields.Text()
    date = fields.Datetime(default=fields.Datetime.now)
    field_name = fields.Char(string="Changed Field")

    category = fields.Selection([
        ('general', 'General'),
        ('vlan', 'VLAN'),
    ], default='general', string="Comment Category")

    is_hidden_in_ui = fields.Boolean(default=False, string="Hidden in UI")

    @api.model_create_multi
    def create(self, vals_list):
        """Ensure user_id is set to current user if not provided."""
        for vals in vals_list:
            if isinstance(vals, dict) and not vals.get('user_id'):
                vals['user_id'] = self.env.uid
        return super().create(vals_list)

    @api.model
    def edit_comment_rpc(self, comment_id, new_text, new_date=None):
        comment = self.browse(comment_id)
        if comment.exists():
            # Check if user is author or admin
            is_admin = self.env.user.has_group('base.group_system')
            is_author = comment.user_id and comment.user_id.id == self.env.uid
            
            if not (is_author or is_admin):
                return {'success': False, 'error': 'Only the author or admin can edit this comment'}
            
            vals = {'comment_text': new_text}
            if new_date:
                vals['date'] = new_date
        
            comment.write(vals)
            return {'success': True}
    
        return {'success': False, 'error': 'Comment not found'}