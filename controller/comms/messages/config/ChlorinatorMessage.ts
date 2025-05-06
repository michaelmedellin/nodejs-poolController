/*  nodejs-poolController.  An application to control pool equipment.
Copyright (C) 2016, 2017, 2018, 2019, 2020, 2021, 2022.  
Russell Goldin, tagyoureit.  russ.goldin@gmail.com

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/
import { sys, Chlorinator } from "../../../Equipment";
import { Inbound } from "../Messages";
import { state } from "../../../State";
import { logger } from "../../../../logger/Logger"
export class ChlorinatorMessage {
    public static process(msg: Inbound): void {
        var chlorId;
        var chlor: Chlorinator;
        switch (msg.extractPayloadByte(1)) {
            case 0:
                chlorId = 1;
                for (let i = 0; i < 4 && i + 30 < msg.payload.length; i++) {
                    let isActive = msg.extractPayloadByte(i + 22) === 1;
                    chlor = sys.chlorinators.getItemById(chlorId);
                    if (chlor.master !== 0) continue; // RSG: probably never need this.  See Touch chlor below.
                    if (isActive) {
                        chlor = sys.chlorinators.getItemById(chlorId, true);
                        let schlor = state.chlorinators.getItemById(chlor.id, true);
                        chlor.isActive = schlor.isActive = true;
                        chlor.master = 0;
                        chlor.body = msg.extractPayloadByte(i + 2);
                        chlor.type = msg.extractPayloadByte(i + 6);
                        if (!chlor.disabled && !chlor.isDosing) {
                            // RKS: We don't want to change the setpoints if our chem controller disabled
                            // the chlorinator.  These should be 0.
                            if (msg.extractPayloadByte(i + 10) === 0 && chlor.poolSetpoint > 0) logger.info(`Changing pool setpoint to 0 ${msg.extractPayloadByte(i + 10)}`);

                            chlor.poolSetpoint = msg.extractPayloadByte(i + 10);
                            chlor.spaSetpoint = msg.extractPayloadByte(i + 14);
                        }
                        chlor.superChlor = msg.extractPayloadByte(i + 18) === 1;
                        chlor.isActive = msg.extractPayloadByte(i + 22) === 1;
                        chlor.superChlorHours = msg.extractPayloadByte(i + 26);
                        chlor.address = 80 + i;
                        schlor.body = chlor.body;
                        schlor.poolSetpoint = chlor.poolSetpoint;
                        schlor.spaSetpoint = chlor.spaSetpoint;
                        schlor.type = chlor.type;
                        schlor.model = chlor.model;
                        schlor.isActive = chlor.isActive;
                        schlor.superChlorHours = chlor.superChlorHours;
                        state.emitEquipmentChanges();
                    }
                    else {
                        sys.chlorinators.removeItemById(chlorId);
                        state.chlorinators.removeItemById(chlorId);
                    }
                    chlorId++;
                }
                msg.isProcessed = true;
                break;
            default:
                logger.debug(`Unprocessed Config Message ${msg.toPacket()}`)
                break;
        }
    }
    public static processTouch(msg: Inbound) {
        //[255, 0, 255][165, 1, 15, 16, 25, 22][1, 90, 128, 58, 128, 0, 73, 110, 116, 101, 108, 108, 105, 99, 104, 108, 111, 114, 45, 45, 54, 48][8, 50]
        // This is for the 25 message that is broadcast from the OCP.
        let chlor = sys.chlorinators.getItemById(1);
        if (chlor.master !== 0 && typeof chlor.master !== 'undefined') return;  // Some Aquarite chlors need more frequent control (via Nixie) but will be disabled via Touch.  https://github.com/tagyoureit/nodejs-poolController/issues/349
        let isActive = (msg.extractPayloadByte(0) & 0x01) === 1;
        if (isActive) {
            let chlor = sys.chlorinators.getItemById(1, true);
            let schlor = state.chlorinators.getItemById(1, true);
            chlor.master = 0;
            chlor.isActive = schlor.isActive = isActive;
            if (!chlor.disabled) {
                // RKS: We don't want these setpoints if our chem controller disabled the
                // chlorinator.  These should be 0 anyway.
                schlor.spaSetpoint = chlor.spaSetpoint = msg.extractPayloadByte(0) >> 1;
                schlor.poolSetpoint = chlor.poolSetpoint = msg.extractPayloadByte(1);
                chlor.address = msg.dest;
                schlor.body = chlor.body = sys.equipment.shared === true ? 32 : 0;
            }
            let name = msg.extractPayloadString(6, 16).trimEnd();
            if (typeof chlor.name === 'undefined') schlor.name = chlor.name = name;
            if (typeof chlor.model === 'undefined') {
                chlor.model = sys.board.valueMaps.chlorinatorModel.getValue(schlor.name.toLowerCase());
                if (typeof chlor.model === 'undefined') {
                    if (name.startsWith('iChlor')) chlor.model = sys.board.valueMaps.chlorinatorModel.getValue('ichlor-ic30');
                }
            }
            if (typeof chlor.type === 'undefined') chlor.type = schlor.type = 0; 
            schlor.saltLevel = msg.extractPayloadByte(3) * 50 || schlor.saltLevel;
            schlor.status = msg.extractPayloadByte(4) & 0x007F; // Strip off the high bit.  The chlorinator does not actually report this.;
            // Pull the hours from the 25 message.
            let hours = msg.extractPayloadByte(5);
            // If we are not currently running a superChlor cycle this will be our initial hours so
            // set the superChlorHours when:
            // 1. We are not superChlorinating and the hours > 0
            // 2. We don't have any superChlor hours yet.  This is when superChlorHours is undefined.
            if ((!schlor.superChlor && hours > 0)) {
                schlor.superChlorHours = chlor.superChlorHours = hours;
            }
            else if (typeof chlor.superChlorHours === 'undefined') {
                // The hours could be 0 because Touch doesn't persist this value out of the gate so we
                // will initialize this to a modest 8 hours.
                schlor.superChlorHours = chlor.superChlorHours = hours || 8;
            }
            schlor.superChlor = chlor.superChlor = hours > 0;
            if (schlor.superChlor) {
                schlor.superChlorRemaining = hours * 3600;
            }
            else {
                schlor.superChlorRemaining = 0;
            }
            if (state.temps.bodies.getItemById(1).isOn) schlor.targetOutput = chlor.disabled ? 0 : chlor.poolSetpoint;
            else if (state.temps.bodies.getItemById(2).isOn) schlor.targetOutput = chlor.disabled ? 0 : chlor.spaSetpoint;
        }
        else {
            sys.chlorinators.removeItemById(1);
            state.chlorinators.removeItemById(1);
        }
        msg.isProcessed = true;
    }
}