﻿import { webApp, REMInterfaceServer, InterfaceServerResponse } from "../../web/Server";
import { logger } from "../../logger/Logger";
import e = require("express");
export interface INixieControlPanel {
    getREMServers();
    logData(file: string, data: any);
    readLogFile(file: string);
}
export class NixieEquipment {
    protected _pmap = new WeakSet();
    //private _dataKey = { id: 'parent' };
    constructor(ncp: INixieControlPanel) { this._pmap['ncp'] = ncp; }
    public get controlPanel(): INixieControlPanel { return this._pmap['ncp']; }
    public get id(): number { return -1; }
    public static get isConnected(): boolean {
        let servers = webApp.findServersByType("rem");
        for (let i = 0; i < servers.length; i++) {
            if (!servers[0].isConnected) return false;
        }
        return true;
    }
    public static async putDeviceService(uuid: string, url: string, data?: any, timeout: number = 3600): Promise<InterfaceServerResponse> {
        try {
            let result: InterfaceServerResponse;
            let server = webApp.findServerByGuid(uuid);
            if (typeof server === 'undefined')
                return InterfaceServerResponse.createError(new Error(`Error sending device command: Server [${uuid}] not found.`));
            if (!server.isConnected) {
                logger.warn(`Cannot send PUT ${url} to ${server.name} server is not connected.`);
                return InterfaceServerResponse.createError(new Error(`Error sending device command: [${server.name}] not connected.`));
            }
            if (server.type === 'rem') {
                let rem = server as REMInterfaceServer;
                result = await rem.putApiService(url, data, timeout);
                // If the result code is > 200 we have an issue.
                //if (result.status.code > 200 || result.status.code === -1)
                //    return Promise.reject(new Error(`putDeviceService: ${result.error.message}`));
            }
            return result;
        }
        catch (err) { return Promise.reject(err); }
    }
    public static async getDeviceService(uuid: string, url: string, data?: any, timeout:number = 3600): Promise<any> {
        try {
            let result: InterfaceServerResponse;
            let server = webApp.findServerByGuid(uuid);
            if (typeof server === 'undefined') return Promise.reject(new Error(`Error sending device command: Server [${uuid}] not found.`));
            if (!server.isConnected) return Promise.reject(new Error(`Error sending device command: [${server.name}] not connected.`));
            if (server.type === 'rem') {
                let rem = server as REMInterfaceServer;
                //console.log(`CALLING GET FROM GETDEVSER`);
                
                result = await rem.getApiService(url, data, timeout);
                //console.log(`RETURNING GET FROM GETDEVSER`);
                // If the result code is > 200 we have an issue.
                if (result.status.code > 200) return Promise.reject(new Error(`putDeviceService: ${result.error.message}`));
            }
            return result;
        }
        catch (err) { return Promise.reject(err); }
    }
    public async closeAsync() {
        try {
        }
        catch (err) { logger.error(`Error closing Nixie Equipment: ${err.message}`); }
    }
}
export class NixieChildEquipment extends NixieEquipment {
    constructor(parent: NixieEquipment) {
        super(parent.controlPanel);
        this._pmap['parent'] = parent;
    }
    public getParent(): NixieEquipment { return this._pmap['parent']; }
}
export class NixieEquipmentCollection<T> extends Array<NixieEquipment> {
    private _pmap = new WeakSet();
    public get controlPanel(): INixieControlPanel { return this._pmap['ncp']; }
    constructor(ncp: INixieControlPanel) {
        super();
        this._pmap['ncp'] = ncp;
    }
    public async removeById(id: number) {
        try {
            let ndx = this.findIndex(elem => elem.id === id);
            if (ndx >= 0) {
                let eq = this[ndx];
                await eq.closeAsync();
                this.splice(ndx, 1);
                logger.info(`Removing chem doser id# ${id} at index ndx`);
            }
            else
                logger.warn(`A Nixie equipment item was not found with id ${id}. Equipment not removed.`);
        }
        catch (err) { return Promise.reject(err); }
    }
}
//export class NixieRelay extends NixieEquipment {

//}
//export class NixieCircuit extends NixieRelay {

//}
//export class NixieValve extends NixieRelay {

//}