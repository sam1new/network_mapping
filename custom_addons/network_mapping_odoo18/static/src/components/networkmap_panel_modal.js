/** @odoo-module **/
const { Component, useState, onMounted, onWillUnmount } = owl;
import { ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {useService} from "@web/core/utils/hooks";

export class PanelModal extends Component {
    static template = "network_map_main.PanelModal";
    static props = ["panelId", "ip", "type", "serial", "close", "onSaved"];

    setup() {
        this.dialog = useService("dialog");
        this.state = useState({
            ip: this.props.ip || "",
            type: this.props.type || "",
            serial: this.props.serial || "",
            saving: false,
        });

        onMounted(async () => {
          document.body.classList.add("nm-confirmation-dialog");  
        });

        onWillUnmount(() => {
            document.body.classList.remove("nm-confirmation-dialog");
        });
    }

    async save() {
        this.dialog.add(ConfirmationDialog, {
            title: "",
            body: `Are you sure you want to save device with IP: ${this.state.ip}?`,
            confirmLabel: "Save Changes",
            confirm: async () => {
                this.state.saving = true;
                try{
                    await this.props.onSaved({
                        ip: this.state.ip,
                        type: this.state.type,
                        serial: this.state.serial,
                    });
                    this.props.close();
                } finally {
                    this.state.saving = false;
                }
            },
            cancel: () => {}
        });
    }
}