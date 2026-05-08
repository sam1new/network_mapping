/** @odoo-module **/
const { Component, useState, onWillStart, onMounted, onWillUnmount } = owl;
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

export class PortModal extends Component {
    static template = "network_map_main.PortModal";
    static props = {

        portId: { type: [Number, String], optional: true },
        portName: { type: String },
        portNumber : {type: [String, Number], optional: true},

        initialComments: { type: Array, optional: true },
        initialVlanId: { type: String, optional: true },
        initialEmployeeId: { type: [Number, String, Boolean], optional: true },
        initialAssignedUser: { type: String, optional: true },
        initialDepartment: { type: String, optional: true },

        initialHistory: { type: Array, optional: true },

        deviceInfo: { type: Object, optional: true },
        close: { type: Function },
        onSaved: { type: Function },

    };

      _getSessionUserName() {

        try {
            const userSvc = this.env?.services?.user || this.userSvc;
            if (userSvc?.name) return userSvc.name;
        } catch (_) {}
        try {
            const sessionSvc = this.env?.services?.session || this.sessionSvc;
            if (sessionSvc?.name) return sessionSvc.name;
        } catch (_) {}
        try {
            const sess = window?.odoo?.session_info;
            if (sess?.name) return sess.name;
        } catch (_) {}
        return "";
    }

    get authorDisplay() {
        const s = (this.state.commentAuthor || "").trim();
        return s || this._getSessionUserName() || "";
    }

    get isAuthorResolved() {
        return !!this.authorDisplay;
    }


    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.dialog = useService("dialog");
        const parts = this.getPortParts(this.props.portName);

        try { this.userSvc = useService("user"); } catch (_) {}
        try { this.sessionSvc = useService("session"); } catch (_) {}

        const initialAuthor = this._getSessionUserName();

        this.state = useState({
            comments: [],
            systemActivities: [],
            workstationActivities: [],
            vlanActivities: [],

            currentTab: "general",
            prefix: parts.prefix || "", 
            suffix: parts.suffix || "",
            vlanId: this.props.initialVlanId || "",

            assignedUser: this.props.initialAssignedUser || "", 
            department: this.props.initialDepartment || "",  
            
            commentAuthor: initialAuthor || "",

            editingCommentId: null,
            editingText: "",

            newText: "",
            newDate: this._nowLocalForInput(),
            saving: false,

        });

        onWillStart(async () => {
            const portId = this.props.portId;
            if (!this.state.commentAuthor) {
                try {
                    const name = await this.orm.call("network.map.port", "get_current_user_name", []);
                    if (name) this.state.commentAuthor = name;
                } catch (_) {
                
                }
            }
            if (!portId) return;

            const commentPayload = await this.orm.call(
                "network.map.port",
                "get_port_comments_rpc",
                [portId]
            );
            if (commentPayload?.success) {
                this.state.comments = (commentPayload.comments || []).map(c => ({...c, isNew: false}));
            } else {
                this.state.comments = [];
            }
            
            const systemPayload = await this.orm.call(
                "network.map.port",
                "get_recent_system_activity_rpc",
                [portId, 20]
            );
            if (systemPayload?.success) {
                this.state.systemActivities = systemPayload.activity.map(log => ({
                ...log,
                display_name: log.user_name || "System"
            }));
            } else {
                const logs = await this.orm.searchRead(
                    "network.map.comment",
                    [["port_id", "=", portId], ["field_name", "in", ["full_port_name", "vlan_id"]]],
                    ["user_name", "date", "comment_text", "field_name"],
                    { order: "date DESC", limit: 10 }
                );
                this.state.systemActivities = logs.map(l => ({
                    ...l,
                    display_name: l.user_name || "System"
                }));
            }

            const workstationPayload = await this.orm.call(
                "network.map.port",
                "get_recent_workstation_activity_rpc",
                [portId, 20]
            );
            if (workstationPayload?.success) {
                this.state.workstationActivities = workstationPayload.activity;
            }

            const vlanPayload = await this.orm.call(
                "network.map.port",
                "get_field_history_rpc",
                [portId, 20]
            );
            if (vlanPayload?.success) {
                this.state.vlanActivities = vlanPayload.history;
            }
        });
        
        onMounted(async () => {
            document.body.classList.add("nm-confirmation-dialog");
            if (!this.state.commentAuthor) {
                const maybe = this._getSessionUserName();
                if (maybe) this.state.commentAuthor = maybe;
            }
        });

        onWillUnmount(() => {
            document.body.classList.remove("nm-confirmation-dialog");
        });
    }


    setTab = (tab) => {
        this.state.currentTab = tab;
    }

    get combinedLabel() {
        const p = (this.state.prefix || "").trim();
        const s = (this.state.suffix || "").trim();
        const result = (p && s) ? `${p}-${s}` : (p || s || ""); 
        return result.trim();
    }

    get filteredComments() {
    return this.state.comments || [];
}
    
    _nowLocalForInput() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    
    _normalizeDateStr(s) {
            // Accept "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD HH:MM:SS"
            if (!s) return "";
            return s.includes("T") ? s : s.replace(" ", "T");
        }
        _sortByDateDesc(list, field = "date") {
            const norm = (v) => this._normalizeDateStr(v || "");
            return [...(list || [])].sort(
                (a,b) => new Date(norm(b[field])) - new Date(norm(a[field]))
            );
        }


        // --- Getters for the Template ---

        get recentHistory() {
            return this.state.vlanActivities || [];
        }

        get filteredComments() {
            return this.state.vlanActivities || [];
        }

        get recentComments() {
            const manualOnly = this.state.comments.filter(c => !c.field_name);
            return this._sortByDateDesc(manualOnly);
        }

        get recentSystemActivity() {
            return this.state.systemActivities || [];
        }

        get recentWorkstationActivity() {
            return this.state.workstationActivities || [];
        }

        get recentVlanActivity() {
            return this.state.vlanActivities || [];
        }

   async showFullHistory() {
    await this.action.doAction({
        type: 'ir.actions.act_window',
        name: `Port Comments History: ${this.props.portName}`,
        res_model: 'network.map.comment',
        view_mode: 'list',
        views: [[false, 'list']],
        view_id: 'network_map_main.view_patch_quest_comment_list',
        target: 'new',
        domain: [
            ['port_id', '=', this.props.portId],
             '|', ['category', '=', 'general'], ['category', '=', false],
            ['is_hidden_in_ui', '=', false],   // optional but recommended
        ],
        context: {
            default_port_id: this.props.portId,
            default_category: 'general',       // ensures inline create in this view is 'general'
            is_cyber_history: true,
        },
    });
}

    async showFullWorkstationHistory() {
        await this.action.doAction({
            type: 'ir.actions.act_window',
            name: `Workstation History: ${this.props.portName}`,
            res_model: 'network.map.workstation.history',
            view_mode: 'list',
            views: [[false, 'list']],
            view_id: 'network_map_main.view_workstation_history_list',
            target: 'new',
            domain: [['port_id', '=', this.props.portId]],
            context: {
                default_port_id: this.props.portId,
                search_default_port_id: this.props.portId,
                is_ws_history: true,
            },
        });
    }

    getPortParts(fullLabel) {
        if (!fullLabel) return { prefix: '', suffix: '' };
        const idx = fullLabel.lastIndexOf('-');
        return idx === -1 ? { prefix: fullLabel, suffix: '' } : { prefix: fullLabel.slice(0, idx), suffix: fullLabel.slice(idx + 1) };
    }

    _now() { return new Date().toISOString().slice(0, 16); }

    // Check if current user can edit a comment
    _canEditComment(comment) {
    
        if (comment.can_edit !== undefined) {
            return comment.can_edit;
        }
        
        // Fallback: Check if user_id matches current user
        if (comment.user_id) {
            // user_id is an array [id, name] or just the id
            const userId = Array.isArray(comment.user_id) ? comment.user_id[0] : comment.user_id;
            try {
                const userSvc = this.env?.services?.user;
                if (userSvc?.userId) {
                    return userId === userSvc.userId;
                }
            } catch (_) {}
        }
        return false;
    }

    // --- Comment Edit Methods ---

startEdit(comment) {
    // Check if user has permission to edit this comment
    if (!comment.can_edit) {
        if (this.env.services.notification) {
            this.env.services.notification.add("You do not have permission to edit this comment", { type: "danger" });
        }
        return;
    }
    this.state.editingCommentId = comment.id;
    this.state.editingText = comment.comment_text;
}

cancelEdit() {
    this.state.editingCommentId = null;
    this.state.editingText = "";
}

async saveEdit(comment) {
    const newText = (this.state.editingText || "").trim();

    if (!newText || newText === comment.comment_text) {
        this.cancelEdit();
        return;
    }

    const updatedDate = this._nowLocalForInput(); 
    // Format for Odoo server (YYYY-MM-DD HH:MM:SS)
    const serverDate = updatedDate.replace('T', ' ') + ':00';

    try {
        const result = await this.orm.call(
            "network.map.comment", 
            "edit_comment_rpc", 
            [comment.id, newText, serverDate]
        );
        
        if (result && result.success) {
            comment.comment_text = newText;
            comment.date = updatedDate;
            this.cancelEdit();
            
            if (this.env.services.notification) {
                this.env.services.notification.add("Comment updated", { type: "success" });
            }
        } else {
            console.error("Server error editing comment:", result?.error);
        }
    } catch (error) {
        console.error("Failed to call edit_comment_rpc:", error);
    }
}

    addComment = () => {
        if (!this.isAuthorResolved || !this.state.newText.trim()) return;
        const text = (this.state.newText || "").trim();
        if (!text) return;
        
        const newEntry = {
            id: Date.now(),
            user_name: this.authorDisplay,
            date: this.state.newDate || this._nowLocalForInput(),
            comment_text: text,
            category: 'general',
            isNew: true,
        };

        this.state.comments = [newEntry, ...this.state.comments];
        this.state.newText = "";
    };

    removeComment = async (log) => {
            if (log.id && !log.isNew) {
                await this.orm.write("network.map.comment", [log.id], { is_hidden_in_ui: true });
            }
            this.state.comments = this.state.comments.filter(c => c !== log);
    };

_getEditedFields() {
    const edited = [];
    const unedited = [];

    if ((this.props.portName || "").trim() !== this.combinedLabel.trim()) edited.push("Port Number"); else unedited.push("Port Number");
    if ((this.props.initialVlanId || "") !== (this.state.vlanId || "")) edited.push("VLAN ID"); else unedited.push("VLAN ID");
    if ((this.props.initialAssignedUser || "") !== (this.state.assignedUser || "")) edited.push("Employee"); else unedited.push("Employee");
    if ((this.props.initialDepartment || "") !== (this.state.department || "")) edited.push("Department"); else unedited.push("Department");
    if (this.state.comments.some(c => c.isNew)) edited.push("Comments"); else unedited.push("Comments");


    return { edited, unedited };
}

    save = async () => {
        if (this.state.saving) return;

        const label = this.combinedLabel;
        const { unedited } = this._getEditedFields();

        let bodyMessage = "Are you sure you want to save?";
    
        if (unedited.length > 0) {
            const uneditedList = unedited.map(field => `• ${field}`).join('\n');
            bodyMessage += `\n\nThe following fields are still unedited:\n${uneditedList}`;
        }

        this.dialog.add(ConfirmationDialog, {
            title: "",
            body: bodyMessage,
            cancelLabel: "Cancel",
            confirmLabel: "Save Changes",
   
                confirm : async () => {
                    this.state.saving = true;
                    try {
                        const normalizeForServer = (s) =>
                            (s && s.includes('T') ? s.replace('T', ' ') + ':00' : s);

                        const newCommentsOnly = this.state.comments
                            .filter(c => c.isNew === true)
                            .map(c => [0, 0, {
                                user_name: this.authorDisplay,
                                comment_text: c.comment_text,
                                date: normalizeForServer(c.date),
                                category: 'general',
                            }]);

                        const payload = {
                            new_full_port_name: this.combinedLabel.trim() || "",
                            vlan_id: this.state.vlanId,
                            assigned_user: this.state.assignedUser,
                            department: this.state.department,
                        };

                        if (newCommentsOnly.length) {
                            payload.comment_ids = newCommentsOnly;
                        }

                        await this.props.onSaved(payload);
                        
                        if (this.state.vlanId !== this.props.initialVlanId) {
                            this.env.bus.trigger('REFRESH_VLAN_INDICATORS', {portId: this.props.portId});
                        }

                        


                        this.props.close();
                    } catch (error) {
                        console.error("Failed to save port data.", error);
                    } finally {
                        this.state.saving = false;
                    }
                },
            cancel: () => {},
        });
    }

}