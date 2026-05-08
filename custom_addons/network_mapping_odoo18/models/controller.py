from odoo import http
from odoo.http import request

class PatchQuestController(http.Controller):

    @http.route('/patch_quest/get_cabinet_data', type='json', auth='user')
    def get_cabinet_data(self, floor, cabinet):
        """Standard RPC entry point"""
        return request.env['patch.panel'].get_cabinet_panel_data(floor, cabinet)