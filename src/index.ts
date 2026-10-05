import {Plugin} from "siyuan";
import "./index.scss";

export default class ReleaseNotePlugin extends Plugin {
    override onload() {
        console.log(`[${this.name}] loaded`);
    }

    override onunload() {
        console.log(`[${this.name}] unloaded`);
    }
}
