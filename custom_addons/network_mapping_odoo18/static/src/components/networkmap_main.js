/** @odoo-module **/
import { PortModal } from "./networkmap_port_modal";
import { VlanModal } from "./networkmap_vlan_modal";
import { PanelModal } from "./networkmap_panel_modal";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

const {
    Component,
    useState,
    onMounted, // Added to handle initial theme application
    onWillUnmount,
    onWillDestroy,
} = owl;

export class NetworkMapMain extends Component {
    static template = "network_map_main.NetworkMapMain";
    static components = { PortModal, PanelModal, VlanModal };

    setup() {
        super.setup();
        this._refreshHandle = null;

        this.state = useState({
            isLoading: true,
            dataLoaded: false,
            filterStatus: "",
            search: "",
            panels: [],
            showModal: false,
            modalType: null,
            modalProps: {},
            selectedPort: null,
            selectedPanel: null,
            panelTitle: "LINKING SYSTEM...",
            deletedCommentIds: [],
            vlanStatus: {},
            currentTheme: localStorage.getItem("patch_quest_theme") || "light",
        });

        this.orm = useService("orm");
        this.dialog = useService("dialog");
        this.notification = useService("notification");
        this.bus = useService("bus_service");
        this._busChannels = new Set();
        this._onBusNotification = this._onBusNotification.bind(this)

        this.onSearchInput = this.onSearchInput.bind(this);
        this.onFilterStatus = this.onFilterStatus.bind(this);

        const floor = this.props.action?.params?.floor;
        const cabinet = this.props.action?.params?.cab;
        this.floor = floor;
        this.cabinet = cabinet;

        this.closeModal = this.closeModal.bind(this);
        this.openPortModal = this.openPortModal.bind(this);
        this.openVlanModal = this.openVlanModal.bind(this);

        this.toggleTheme = this.toggleTheme.bind(this);

        // Initial data load
        this.loadWithTimer(this.floor, this.cabinet);
        

        // Apply the initial theme on mount
        onMounted(async() => {
            document.body.classList.add("networkmap_body");
            this.applyTheme(this.state.currentTheme);
        });

        onWillUnmount(() => {
            document.body.classList.remove("networkmap_body");
        });

        onWillDestroy(() => {
            this.state.isLoading = true;
            this.state.dataLoaded = false;
        
        try {
            if (this.bus) {
                if (typeof this.bus.removeEventListener === "function" && this._onBusNotificationBound) {
                    this.bus.removeEventListener("notification", this._onBusNotificationBound);
                } else if (typeof this.bus.off === "function" && this._onBusNotificationBound) {
                    try {
                        this.bus.off("notification", this, this._onBusNotificationBound);
                    } catch {
                        this.bus.off("notification", this._onBusNotificationBound);
                    }
                }
            }
        } catch {}

        });
    }

    /**
     * Toggles between 'light' and 'dark' modes
     */
    toggleTheme() {
        const newTheme = this.state.currentTheme === "dark" ? "light" : "dark";
        this.state.currentTheme = newTheme;
        localStorage.setItem("patch_quest_theme", newTheme);
        this.applyTheme(newTheme);
    }

    /**
     * Updates the DOM classes to trigger the CSS themes
     * @param {string} theme - 'light' or 'dark'
     */
    applyTheme(theme) {
        if (theme === "light") {
            document.body.classList.remove("dark");
            document.body.classList.add("light-mode"); // Matches your light mode CSS file
        } else {
            document.body.classList.remove("light-mode");
            document.body.classList.add("dark");
        }
    }

    // --- Data Loading Logic ---

    async loadData() {
        return this.loadWithTimer(this.floor, this.cabinet);
    }

    async loadWithTimer(floor, cabinet) {
        Object.assign(this.state, {
            isLoading: true,
            dataLoaded: false,
            panels: [],
            panelTitle: "LINKING SYSTEM...",
        });

        const dataPromise = this._loadPanelData(floor, cabinet);
        const timerPromise = new Promise((resolve) => setTimeout(resolve, 1000));

        try {
            await Promise.all([dataPromise, timerPromise]);
        } catch (error) {
            console.error("Loading failed", error);
        } finally {
            this.state.isLoading = false;
            this.state.dataLoaded = true;
        }
    }

    async _loadPanelData(floor, cabinet) {
        this.state.isLoading = true;
        try {
            this.state.dataLoaded = false;
            this.state.panelTitle = `Accessing ${cabinet}...`;

            const rpcResult = await this.orm.call("patch.panel", "get_cabinet_panel_data", [
              floor, cabinet,
            ]);


            if (!rpcResult || rpcResult.length === 0) {
                this.state.panelTitle = `No Data Found: ${floor} - ${cabinet}`;
                this.state.panels = [];
                this.state.dataLoaded = true;
                return;
            }

            const panelsToDisplay = rpcResult.map((panelData, index) => {
                const portCount = Number(panelData.port_count);
                const ports = this._ensurePorts(panelData.port_map || [], portCount);
                const customRow1 = [];
                const customRow2 = [];

                for (let i = 0; i < ports.length; i++) {
                    if ((i + 1) % 2 === 1) {
                        customRow1.push(ports[i]);
                    } else {
                        customRow2.push(ports[i]);
                    }
                }

                return {
                    id: panelData.id || index + 1,
                    name: panelData.name || `PP ${index + 1}`,
                    device: panelData.device || null,
                    ports,
                    customRow1,
                    customRow2,
                };
            });

            this.state.panels = panelsToDisplay;
            this.state.panelTitle = cabinet;
            this.state.dataLoaded = true;

            const allPorts = panelsToDisplay.flatMap(p => p.ports).filter(pt => pt.id > 0);
            await this.checkVlanIndicators(allPorts)
            this._resubscribeBusChannel();
        } catch (error) {
            console.error("Failed to load panel data:", error);
            this.state.panelTitle = `Error loading ${cabinet}`;
            this.notification.add("Connection Error: Could not reach server", {
                type: "danger",
            });
        }
    }

    async checkVlanIndicators(ports) {
        if (!ports || ports.length === 0) return;

        const portIds = ports.map(p => p.id);

        try {
            const resultsMap = await this.orm.call(
                "network.map.port",
                "get_vlan_indicators_batch",
                [portIds]
            );

            if (resultsMap) {
                Object.assign(this.state.vlanStatus, resultsMap);
            }
        } catch (e) {
            console.error("Batch indicator check failed", e);
        }
    }


    _ensurePorts(list, portCount) {
        const byNum = {};
        for (const p of list) {   
            const n = Number(p.num);
            if (!Number.isFinite(n)) continue;

            byNum[n] = {
                id: p.id,
                num: n,
                label: p.label || "",
                status: p.status || "free",
                vlan_id: p.vlan_id || "",
                assigned_user: p.assigned_user || "",
                department: p.department || "",
                desktop_ip: p.desktop_ip || "", 
                hostname: p.hostname || "",     
                has_comment: !!p.has_comment,
                has_vlan_comment: !!p.has_vlan_comment,
                comment_ids: p.comment_ids || [],
            };
        }
        const out = [];
        for (let i = 1; i <= portCount; i++) {
            out.push(
                byNum[i] || {
                    id: 0,
                    num: i,
                    label: "",
                    status: "free",
                    comment_ids: [],
                    vlan_id: "",
                    assigned_user: "",
                    department: "",
                    has_comment: false,
                    has_vlan_comment: false,
                },
            );
        }
        return out;
    }

    onSearchInput = (ev) => {
        this.state.search = ev.target.value || "";
    };

    onFilterStatus = (ev) => {
        this.state.filterStatus = ev.target.value || "";
    };

    get filteredPanels() {
        // If no filter is active, return all panels (with all ports)
        const hasFilter = this.state.search.trim() || this.state.filterStatus;
        
        if (!hasFilter) return this.state.panels;

        return this.state.panels.map(panel => {
            return {
                ...panel,
                customRow1: panel.customRow1.filter(port => this.isMatch(port)),
                customRow2: panel.customRow2.filter(port => this.isMatch(port)),
            };
        }).filter(panel => panel.customRow1.length > 0 || panel.customRow2.length > 0);
    }

    isMatch(port) {
        const s = (this.state.search || "").toLowerCase().trim();
        const f = (this.state.filterStatus || "").trim();

        const matchSearch = !s || 
            String(port.num).includes(s) ||
            (port.label || "").toLowerCase().includes(s) ||
            (port.assigned_user || "").toLowerCase().includes(s);

  
        const matchStatus = !f || port.status === f;

        return matchSearch && matchStatus;
    }

    _commitPanelPorts = (panel) => {
        const customRow1 = [];
        const customRow2 = [];
        panel.ports.forEach((port, index) => {
            if ((index + 1) % 2 === 1) {
                customRow1.push(port);
            } else {
                customRow2.push(port);
            }
        });
        panel.customRow1 = customRow1;
        panel.customRow2 = customRow2;
    };

    _resubscribeBusChannel() {
    if (!this.bus) return;
    // Clear previous channels
    for (const ch of this._busChannels) {
        if (typeof this.bus.deleteChannel === "function") {
            this.bus.deleteChannel(ch);
        }
    }

    this._busChannels.clear();

    // Subscribe current panels
    for (const p of this.state.panels || []) {
        const ch = `network_map:panel:${p.id}`;
        if (typeof this.bus.addChannel === "function") {
            this.bus.addChannel(ch);
        }
        this._busChannels.add(ch);
    }
    
        if (!this._onBusNotificationBound) {
            this._onBusNotificationBound = (notifications) => this._onBusNotification(notifications);
    }
    
    try {
        if (typeof this.bus.removeEventListener === "function") {
            this.bus.removeEventListener("notification", this._onBusNotificationBound);
        } else if (typeof this.bus.off === "function") {
            try {
                this.bus.off("notification", this, this._onBusNotificationBound);
            } catch {
                this.bus.off("notification", this._onBusNotificationBound);
            }
        }
    } catch {
        // ignore
    }
    
    if (typeof this.bus.addEventListener === "function") {
        this.bus.addEventListener("notification", this._onBusNotificationBound);
    } else if (typeof this.bus.on === "function") {
        try {
            this.bus.on("notification", this, this._onBusNotificationBound);
        } catch {
            this.bus.on("notification", this._onBusNotificationBound);
        }
    }
    
    if (typeof this.bus.startPolling === "function") {
        this.bus.startPolling();
    }
}

_onBusNotification(notifications = []) {
    for (const n of notifications) {
        const channel = n.channel;
        const msg = n.payload || n.message || {};
        if (!msg || msg.model !== "network.map.port") continue;

        if (msg.event === "port:update") {
            this._applyPortUpdate(msg);
        } else if (msg.event === "port:create") {
            this._applyPortCreate(msg);
        }
    }
}

_applyPortUpdate(msg) { 

    if (this.state.modalType === "vlan") {
        return;
    }

    const panel = (this.state.panels || []).find((p) => String(p.id) === String(msg.panel_id));
    if (!panel) return;

    // Prefer to find by port_number, fallback by id
    const byNum = panel.ports.find((pt) => Number(pt.num) === Number(msg.port_number));
    const port = byNum || panel.ports.find((pt) => Number(pt.id) === Number(msg.port_id));
    if (!port) return;

    // Merge fields
    const d = msg.data || {};
    if (d.vlan_id !== undefined){port.vlan_id = d.vlan_id;this.state.vlanStatus[msg.port_id] = true;} 
    if (d.assigned_user !== undefined) port.assigned_user = d.assigned_user;
    if (d.department !== undefined) port.department = d.department;
    if (d.status !== undefined) port.status = d.status;
    if (d.full_port_name !== undefined) port.label = d.full_port_name;
    if (d.has_general_comment !== undefined) port.has_comment = !!d.has_general_comment;
    if (d.has_vlan_comment !== undefined) port.has_vlan_comment = !!d.has_vlan_comment;
    if (d.comment_ids !== undefined) port.comment_ids = d.comment_ids;

    this._commitPanelPorts(panel);
    // No big loader: just re-render
    this.render(true);
}

_applyPortCreate(msg) {
    const panel = (this.state.panels || []).find((p) => String(p.id) === String(msg.panel_id));
    if (!panel) return;

    const idx = Number(msg.port_number);
    const maxPorts = panel.ports.length;
    if (!Number.isFinite(idx) || idx < 1 || idx > maxPorts) return;

    const d = msg.data || {};
    const newPort = {
        id: msg.port_id,
        num: idx,
        label: d.full_port_name || panel.ports[idx - 1]?.label || "",
        status: d.status || (d.assigned_user ? "used" : "free"),
        vlan_id: d.vlan_id || "",
        assigned_user: d.assigned_user || "",
        department: d.department || "",
        has_comment: !!d.has_general_comment,
        has_vlan_comment: !!d.has_vlan_comment,
        comment_ids: d.comment_ids || [],
    };

    // Replace placeholder at that slot
    panel.ports[idx - 1] = newPort;
    this._commitPanelPorts(panel);
    this.render(true);
}

    // --- Modal Logic ---

    async openVlanModal(panel, port) {

        const n = Number(port.id);
        const safePortId = Number.isFinite(n) && n > 0 ? n : undefined;

        let history = [];
         if (safePortId) {
        const result = await this.orm.call(
            "network.map.port",
            "get_field_history_rpc",
            [safePortId, ["vlan_id"]]
        );
        if (result && result.success && Array.isArray(result.history)) {
            history = result.history;
        } else if (Array.isArray(result)) {
            history = result;
        }
    }

        this.dialog.add(VlanModal, {
            portId: safePortId,
            initialVlanId: port.vlan_id,
            initialHistory: history,

            onSaved: async (payload) => {
                let portIdNum = safePortId;
                let result;

                if (!portIdNum) {
                    result = await this.orm.call(
                        "network.map.port",
                        "create_port_rpc",
                        [panel.id, port.num,payload]
                    );
                    if (!result || !result.success) {
                        this.notification.add(
                            (result && result.error) || "Failed to create port.",
                            {type: "danger"}
                        );
                        return;
                    }
                    portIdNum = result.id;
                    port.id = portIdNum;
                } else {
                    result = await this.orm.call(
                        "network.map.port",
                        "update_port_data_rpc",
                        [portIdNum, payload]
                    );
                    if (!result || !result.success) {
                        this.notification.add(
                            (result && result.error) || "Failed to update Vlan.",
                            {type: "danger"}
                        );
                        return;
                    }
                }

                port.vlan_id = result.vlan_id;
                port.comment_ids = result.comment_ids;

                // Refresh modal state comments immediately after save              
                if (this.state) {
                    this.state.comments = result.comment_ids || [];
                    this.state.history = [...this.state.comments];
                }

                port.has_vlan_comment = !!result.has_vlan_comment;
                port.has_comment = !!result.has_comment;

                this._commitPanelPorts(panel);
                this.notification.add("Vlan updated.", {type: "success"});
            },
        });
    }

   async openPortModal(panel, port) {
        
    const n = Number(port.id);
    const safePortId = Number.isFinite(n) && n > 0 ? n : undefined;
        
    let history = [];
    let comments = [];

    if (safePortId) {
        const result = await this.orm.call(
            "network.map.port",
            "get_field_history_rpc",
            [safePortId, ["full_port_name", "vlan_id", "assigned_user", "department"]],
        );

        if (result && result.success && Array.isArray(result.history)) {
            history = result.history;
        } else if (Array.isArray(result)) {
            history = result;
        }

        comments = await this.orm.searchRead(
            "network.map.comment",
            [["port_id", "=", safePortId]],
            ["user_name", "date", "comment_text", "id"],
            {order: "date DESC"}
        );
    }


        this.dialog.add(PortModal, {
            portId: safePortId,
            portName: port.label,
            portNumber: port.num,
            initialComments: comments,
            initialVlanId: port.vlan_id,
            initialAssignedUser: port.assigned_user,
            initialDepartment: port.department,
            deviceInfo: panel.device,
            initialHistory: history, 

            onSaved: async (payload) => {
                let portIdNum = safePortId;
                let result;

                
            if (!portIdNum) {
                result = await this.orm.call(
                "network.map.port",
                "create_port_rpc",
                [panel.id, port.num, payload]
                );
            if (!result || !result.success) {
                this.notification.add((result && result.error) || "Failed to create port.", { type: "danger" });
            return;
                }
                portIdNum = result.id;
                port.id = portIdNum; 
            } else {
                // Update existing
                result = await this.orm.call(
                "network.map.port",
                "update_port_data_rpc",
                [portIdNum, payload]
                );
            if (!result || !result.success) {
                this.notification.add((result && result.error) || "Failed to update port.", { type: "danger" });
            return;
            }
            if (result.success) {
                port.comment_ids = result.comment_ids || [];
            }
        }

            // Apply server result to local port object
            port.label = payload.new_full_port_name || "";
                port.vlan_id = result.vlan_id;
                port.comment_ids = result.comment_ids || [];
                port.has_vlan_comment = !!result.has_vlan_comment;
                port.has_comment = !!result.has_comment;

                if (payload.vlan_id || result.vlan_id) {this.state.vlanStatus[portIdNum] = true;}
                if (typeof result.status !== "undefined") port.status = result.status;
                if (result.new_full_port_name) port.label = result.new_full_port_name;
                if (typeof result.assigned_user !== "undefined") port.assigned_user = result.assigned_user;
                if (typeof result.department !== "undefined") port.department = result.department;

            this._commitPanelPorts(panel);
            this.render(true);
            this.notification.add("Port updated", { type: "success" });
            },

            close: () => {},
        });
    }

    openPanelModal = (panelId) => {
        if (!this.state.panels || !Array.isArray(this.state.panels)) return;

        const panel = this.state.panels.find(
            (p) => String(p.id) === String(panelId),
        );
        if (!panel) return;

        this.state.modalType = "panel";
        this.state.modalProps = {
            panelId: panel.id,
            ip: panel.device?.ip || "",
            type: panel.device?.type || "",
            serial: panel.device?.serial || "",

            onSaved: (payload) => this.onPanelSaved(panel.id, payload),
            close: this.closeModal,
        };
        this.state.showModal = true;
    };

    onPanelSaved = async (panelId, payload) => {
        try {
            await this.orm.call("patch.panel", "write_panel_device_info", [
                panelId,
                payload,
            ]);
            await this.loadData();
            this.closeModal();
            this.notification.add("Panel device updated successfully!", {
                type: "success",
            });
        } catch (error) {
            console.error("Error saving panel device info:", error);
            this.notification.add("Error updating panel device.", { type: "danger" });
        }
    };

    closeModal = () => {
        this.state.showModal = false;
        this.state.modalType = null;
        this.state.modalProps = {};
        this.state.selectedPort = null;
        this.state.selectedPanel = null;
    };
}

registry.category("actions").add("owl.network_map_main", NetworkMapMain);