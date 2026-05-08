/** @odoo-module **/
import { PortModal } from "./networkmap_port_modal";
import { useService } from "@web/core/utils/hooks";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";

const { useState, onWillStart, onMounted, onWillUnmount } = owl;

export class VlanModal extends PortModal {
    static template = "network_map_main.VlanModal";

    static props = {
        ...(PortModal.props || {}),
        portId: {type: [Number, String], optional: true},
        panelId: { type: [Number, String], optional: true },
        portName: { type: String, optional: true },
        initialVlanId: { type: [String, Number], optional: true },
        initialAssignedUser: { type: String, optional: true },
        onSaved: Function,
        close: { type: Function, optional: true },
        portNum: { type: Number, optional: true },
        deletedCommentIds: { type: Array, optional: true },
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
        this.isVlan = true;
        super.setup();

        this.state.comments = [];
        this.state.history = [];

        this.orm = useService("orm") || this.env.services?.orm;
        this.dialog = useService("dialog");
        this.action = useService("action");
        this.notification = useService?.("notification") || this.env.services?.notification;

        const n= Number(this.props.portId);
        this.portId = Number.isFinite(n) && n > 0 ? n : (this.props.portId || null);
        const nPanel = Number(this.props.panelId);
        this.panelId = Number.isFinite(nPanel) && nPanel > 0 ? nPanel : (this.props.panelId || null);

        try { this.userSvc = useService("user"); } catch (_) {}
        try { this.sessionSvc = useService("session"); } catch (_) {}

        const initialAuthor = this._getSessionUserName();

        this.state = useState({
            history: [],
            comments: [],

            vlanId: this.props.initialVlanId || "",

            assignedUser: this.props.initialAssignedUser || "",
            commentAuthor: initialAuthor || "",

            saving: false,
            newText: "",
            newDate: this._nowLocalForInput(),
            deletedIds: [],
        });

        this._tickHandle = null;

         onWillStart(async () => {
            await this._loadVlanData();
            try {

                const portId = this.props.portId;
                
                if (!this.state.commentAuthor) {
                try {
                    const name = await this.orm.call("network.map.port", "get_current_user_name", []);
                    if (name) this.state.commentAuthor = name;
                } catch (_) {
                
                }
                }
                if (!this.state.newDate) {
                    this.state.newDate = this._nowLocalForInput();
                }

                if (portId) {
                
                    const results = await this.orm.call(
                        "network.map.port",
                        "get_field_history_rpc",
                        [portId]
                    );

                    if (results?.success) {
                    this.state.comments = results.history; 
                    this.state.history = [...results.history];
                }
                }
    
                }catch (err) {
                console.error("Failed to fetch history", err);
            }
        });

        onMounted(async () => {
            this._tickHandle = window.setInterval(() => {
                this.state.newDate = this._nowLocalForInput();
            }, 30000);

             if (!this.state.commentAuthor) {
                const maybe = this._getSessionUserName();
                if (maybe) this.state.commentAuthor = maybe;
            }

            await this._loadVlanComments();

            if (!this.state.commentAuthor) {
                const maybe = this._getSessionUserName();
                if (maybe) this.state.commentAuthor = maybe;
            }
        });

        onWillUnmount(() => {
            if (this._tickHandle) {
                window.clearInterval(this._tickHandle);
                this._tickHandle = null;
            }
        });
    }

    // Inside your save or fetch function
    async onHistoryLoaded(logs) {
        if (logs.length > 0) {
            // Update local state for the modal UI
            this.state.recentHistory = logs;
            
            // Trigger event to parent (NetworkMapMain) to show the dot on the grid
            this.env.bus.trigger('UPDATE_VLAN_INDICATOR', {
                portId: this.props.port.id, // or whatever unique ID you use
                hasComment: true
            });
        }
    }
    
async _loadVlanData() {
        if (!this.props.portId) return;
        
        try {
            const results = await this.orm.call(
                "network.map.port",
                "get_field_history_rpc", 
                [this.props.portId]
            );

            if (results?.success && results.history) {
                // 2. Update local state for the modal list
                this.state.comments = results.history;
                this.state.history = [...results.history];

                // 3. Update the indicator logic
                const hasLogs = results.history.length > 0;
                
                // Directly update the prop object so the Grid reflects it immediately
                if (this.props.port) {
                    this.props.port.has_vlan_comment = hasLogs;
                }

                // 4. Trigger the bus event for the parent component listener
                this.env.bus.trigger('UPDATE_VLAN_INDICATOR', {
                    portId: this.props.portId,
                    hasComment: hasLogs
                });
            }
        } catch (err) {
            console.error("VLAN Modal: Failed to fetch history", err);
        }
    }
    
    async _loadVlanComments() {
    if (!this.props.portId) return;
    const results = await this.orm.call(
        "network.map.port",
        "get_field_history_rpc", 
        [this.props.portId]
    );
    this.state.comments = results?.success ? results.history : [];
    this.state.history = [...this.state.comments];
}

    _nowLocalForInput() {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
            d.getHours()
        )}:${pad(d.getMinutes())}`;
    }

    async _assignCurrentUserName() {
        try {
            const userSvc = this.env.services?.user;
            if (userSvc?.name) {
                this.state.assignedUser = userSvc.name;
                return;
            }

            if (window.odoo?.session_info?.name) {
                this.state.assignedUser = window.odoo.session_info.name;
                return;
            }

            const uid =
                userSvc?.userId ||
                this.env.services?.session?.uid ||
                window.odoo?.session_info?.uid;

            if (uid && (this.orm || this.env.services?.orm)) {
                const data = await (this.orm || this.env.services.orm).read(
                    "res.users",
                    [uid],
                    ["name"]
                );
                if (data && data[0]?.name) {
                    this.state.assignedUser = data[0].name;
                }
            }
        } catch (e) {
            console.warn("Could not resolve current user name", e);
        }
    }

    _normalizeDateStr(s) {
    if (!s) return "";
    return s.includes("T") ? s : s.replace(" ", "T");
}

    _sortByDateDesc(list, field = "date") {
        const norm = (v) => this._normalizeDateStr(v || "");
        return [...(list || [])].sort(
            (a, b) => new Date(norm(b[field])) - new Date(norm(a[field]))
        );
    }

    get filteredComments() {
        return this.state.comments || [];
    }

    get recentHistory() {
        return this._sortByDateDesc(this.filteredComments).slice(0, 5);
    }

//     async showFullHistory() {
//     await this.action.doAction({
//         type: 'ir.actions.act_window',
//         name: `VLAN History: ${this.props.portName}`,
//         res_model: 'network.map.comment',
//         view_mode: 'list',
//         views: [[false, 'list']],
//         target: 'new',
//         domain: [
//             ['port_id', '=', this.props.portId],
//             ['field_name', '=', 'vlan_id'], // STRICT: Only show VLAN changes
//             ['is_hidden_in_ui', '=', false],
//         ],
//         context: {
//             default_port_id: this.props.portId,
//             is_cyber_history: true,
//         },
//     });
// }

        _parseToTs(s) {
    if (!s) return 0; 
    // Accept: "YYYY-MM-DD HH:MM[:SS]" or "YYYY-MM-DDTHH:MM[:SS]" (+ optional tz)
    const t = String(s).trim().replace('T', ' ').split(/[+-]?\d{2}:\d{2}$/)[0]; 
    // Ensure seconds
    const parts = t.split(' ');
    if (parts.length === 2 && parts[1].length === 5) {
        // HH:MM -> append :00
        s = `${parts[0]} ${parts[1]}:00`;
    } else {
        s = t;
    }

    const d = new Date(s.replace(' ', 'T')); 
    return isNaN(d.getTime()) ? 0 : d.getTime();
    }
    
    get recentVlanHistory() {
        return this.recentHistory;
    }


    // removeComment = async (log) => {
    //     if (!log) return;
    //     try {
    //         if (log.id && !log.isNew) {
    //             await (this.orm || this.env.services.orm).write(
    //                 "network.map.comment",
    //                 [log.id],
    //                 { is_hidden_in_ui: true }
    //             );
    //         }
    //         this.state.comments = this.state.comments.filter((c) => c !== log);
    //         this.state.history = [...this.state.comments];
    //     } catch (e) {
    //         console.error("Failed to delete VLAN comment", e);
    //     }
    // };

   save = async () => {
    if (this.state.saving) return;

    this.dialog.add(ConfirmationDialog, {
        body: `Confirm changes for VLAN: ${this.state.vlanId}?`,
        confirm: async () => {
            this.state.saving = true;
            try {
                const payload = {
                    vlan_id: this.state.vlanId,
                    assigned_user: (this.state.assignedUser || "").trim(),
                };

                await this.props.onSaved(payload);
                this.props.close();
            } catch (error) {
                console.error("Failed to save Vlan data.", error);
            } finally {
                this.state.saving = false;
            }
        },
    });
};
}