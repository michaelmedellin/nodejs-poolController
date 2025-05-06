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
import { state, ICircuitState, LightGroupState } from "../../../controller/State";
import { sys, ChemController, Circuit, Feature } from "../../../controller/Equipment";
import { utils } from '../../../controller/Constants';
import { logger } from "../../../logger/Logger";
import { ServiceParameterError } from "../../../controller/Errors";
import { Socket } from 'socket.io';
export class StateSocket {
    public static initSockets(sock: Socket) {
        sock.on('/state/circuit/toggleState', async (data: any) => {
            try {
                data = JSON.parse(data);
                await state.circuits.toggleCircuitStateAsync(parseInt(data.id, 10));
                // return res.status(200).send(cstate);
            }
            catch (err) {logger.error(`Socket processing error /state/circuit/toggleState: ${err.message}`);}
        });  
        sock.on('/state/body/heatMode', async (data: any) => {
            // RKS: 06-24-20 -- Changed this so that users can send in the body id, circuit id, or the name.
            try {
                data = JSON.parse(data);
                // Map the mode that was passed in.  This should accept the text based name or the ordinal id value.
                let mode = parseInt(data.mode, 10);
                let val;
                if (isNaN(mode)) mode = parseInt(data.heatMode, 10);
                if (!isNaN(mode)) val = sys.board.valueMaps.heatModes.transform(mode);
                else val = sys.board.valueMaps.heatModes.transformByName(data.mode || data.heatMode);
                if (typeof val.val === 'undefined') {
                    logger.error(new ServiceParameterError(`Invalid value for heatMode: ${data.mode}`, 'body', 'heatMode', mode));
                    return;
                }
                mode = val.val;
                let body = sys.bodies.findByObject(data);
                if (typeof body === 'undefined') {
                    logger.error(new ServiceParameterError(`Cannot set body heatMode.  You must supply a valid id, circuit, name, or type for the body`, 'body', 'id', data.id));
                    return;
                }
                await sys.board.bodies.setHeatModeAsync(body, mode);
                // return res.status(200).send(tbody);
            }
            catch (err) { logger.error(`Socket processing error /state/body/heatmode: ${err.message}`); }
        });
        sock.on('/state/body/setPoint', async (data: any) => {
            // RKS: 06-24-20 -- Changed this so that users can send in the body id, circuit id, or the name.
            try {
                data = JSON.parse(data);
                let body = sys.bodies.findByObject(data);
                if (typeof body === 'undefined') {
                    logger.error(new ServiceParameterError(`Cannot set body setPoint.  You must supply a valid id, circuit, name, or type for the body`, 'body', 'id', data.id));
                    return;
                }
                await sys.board.bodies.setHeatSetpointAsync(body, parseInt(data.setPoint, 10));
                // return res.status(200).send(tbody);
            } catch (err) { logger.error(`Socket processing error /state/body/setPoint: ${err.message}`); }
        });
        sock.on('/temps', async (data: any) => {
            try {
                data = JSON.parse(data);
                await sys.board.system.setTempsAsync(data).catch(err => logger.error(`setTempsAsync: ${err.message}`));
            }
            catch (err) { logger.error(`Socket processing error /temps: ${err.message}`); }
        });
        
        sock.on('/chlorinator', async (data: any) => {
            try {
                data = JSON.parse(data);
                let id = parseInt(data.id, 10);
                let chlor = sys.chlorinators.getItemById(id);
                if (chlor.isActive) {
                    let isBodyOn = sys.board.bodies.isBodyOn(chlor.body);
                    let schlor = state.chlorinators.getItemById(id, true);
                    // Ignore the salt level feed when the body is not on.
                    if (isBodyOn) {
                        if (typeof data.saltLevel !== 'undefined') {
                            let saltLevel = parseInt(data.saltLevel, 10);
                            if (!isNaN(saltLevel) && schlor.saltLevel !== saltLevel) {
                                schlor.saltLevel = saltLevel;
                            }
                        }
                    }
                    if (typeof data.poolSetpoint !== 'undefined' || typeof data.spaSetpoint !== 'undefined') {
                        sys.board.chlorinator.setChlorAsync(data);
                    }
                    schlor.emitEquipmentChange();
                }
            }
            catch (err) { logger.error(`Socket processing error /chlorinator: ${err.message}`); }
        });
        sock.on('/filter', async (data: any) => {
            try {
                data = JSON.parse(data);
                let id = parseInt(data.id, 10);
                let filter = sys.filters.find(elem => elem.id === id);
                if (typeof filter !== 'undefined' && filter.isActive && !isNaN(filter.id)) {
                    let sfilter = state.filters.getItemById(filter.id, filter.isActive)
                    let pu = sys.board.valueMaps.pressureUnits.transform(filter.pressureUnits);
                    if (typeof data.pressure !== 'undefined')
                        await sys.board.filters.setFilterPressure(filter.id, data.pressure, data.pressureUnits || pu.name);
                    sfilter.emitEquipmentChange();
                }
            } catch (err) { logger.error(`Socket processing error /filter: ${err.message}`); }
        });
        sock.on('/chemController', async (data: any) => {
            try {
                //console.log(`chemController: ${data}`);
                data = JSON.parse(data);
                
                // Get the chem controller.
                let id = parseInt(data.id, 10);
                let address = parseInt(data.address, 10);
                let controller: ChemController;
                if (!isNaN(id))
                    controller = sys.chemControllers.getItemById(id);
                else if (!isNaN(address))
                    controller = sys.chemControllers.getItemByAddress(address);
                if (typeof controller !== 'undefined' && controller.isActive === true) {
                    let scontroller = state.chemControllers.getItemById(controller.id);
                    let isBodyOn = scontroller.flowDetected; //sys.board.bodies.isBodyOn(controller.body);
                    if (typeof data.pHLevel !== 'undefined') {
                        if (!isNaN(parseFloat(data.pHLevel))) scontroller.ph.probe.level = parseFloat(data.pHLevel);
                        else if (typeof data.pHLevel === 'object') {
                            if (!isNaN(parseFloat(data.pHLevel.pH))) scontroller.ph.probe.level = parseFloat(data.pHLevel.pH);
                            if (!isNaN(parseFloat(data.pHLevel.temperature))) scontroller.ph.probe.temperature = parseFloat(data.pHLevel.temperature);
                            if (typeof data.pHLevel.tempUnits !== 'undefined') scontroller.ph.probe.tempUnits = sys.board.valueMaps.tempUnits.encode(data.pHLevel.tempUnits);
                        }
                        if (isBodyOn || !controller.ph.flowReadingsOnly) scontroller.ph.level = scontroller.ph.probe.level;
                    }
                    if (typeof data.orpLevel !== 'undefined') {
                        if (!isNaN(parseFloat(data.orpLevel))) scontroller.orp.probe.level = parseFloat(data.orpLevel);
                        else if (typeof data.orpLevel === 'object') {
                            if (!isNaN(parseFloat(data.orpLevel.orp))) scontroller.orp.probe.level = parseFloat(data.orpLevel.orp);
                        }
                        if (isBodyOn || !controller.orp.flowReadingsOnly) scontroller.orp.level = scontroller.orp.probe.level;
                    }
                    if (typeof data.temperature !== 'undefined') scontroller.ph.probe.temperature = data.temperauture;
                    if (typeof data.tempUnits !== 'undefined') scontroller.ph.probe.tempUnits = sys.board.valueMaps.tempUnits.encode(data.tempUnits);
                    if (typeof data.acidTank !== 'undefined') {
                        if (!isNaN(parseFloat(data.acidTank.level))) scontroller.ph.tank.level = parseFloat(data.acidTank.level);
                        if (!isNaN(parseFloat(data.acidTank.capacity))) scontroller.ph.tank.capacity = controller.ph.tank.capacity = parseFloat(data.acidTank.capacity);
                        if (typeof data.acidTank.units === 'string') scontroller.ph.tank.units = controller.ph.tank.units = data.acidTank.units;
                    }
                    if (typeof data.orpTank !== 'undefined') {
                        if (!isNaN(parseFloat(data.orpTank.level))) scontroller.orp.tank.level = parseFloat(data.orpTank.level);
                        if (!isNaN(parseFloat(data.orpTank.capacity))) scontroller.orp.tank.capacity = controller.orp.tank.capacity = parseFloat(data.orpTank.capacity);
                        if (typeof data.orpTank.units === 'string') scontroller.orp.tank.units = controller.orp.tank.units = data.orpTank.units;
                    }
                    if (typeof data.acidPump !== 'undefined' || typeof data.orpPump !== 'undefined') {
                        let chem = typeof data.acidPump !== 'undefined' ? controller.ph : controller.orp;
                        let schem = typeof data.acidPump !== 'undefined' ? scontroller.ph : scontroller.orp;
                        let vals = typeof data.acidPump !== 'undefined' ? data.acidPump : data.orpPump;
                        let pump = chem.pump;
                        switch (sys.board.valueMaps.chemPumpTypes.getName(pump.type)) {
                            case 'ezo-pmp':
                                if (typeof vals.dispense !== 'undefined') {
                                    pump.ratedFlow = typeof vals.dispense.ratedFlow === 'number' ? vals.dispense.ratedFlow : pump.ratedFlow;
                                }
                                if (typeof vals.tank !== 'undefined') {
                                    if (!isNaN(parseFloat(vals.tank.level))) schem.tank.level = parseFloat(vals.tank.level);
                                    if (!isNaN(parseFloat(vals.tank.capacity))) schem.tank.capacity = chem.tank.capacity = parseFloat(vals.tank.capacity);
                                    if (typeof vals.tank.units === 'string') schem.tank.units = chem.tank.units = vals.tank.units;
                                }
                                break;
                        }

                    }
                    // Need to build this out to include the type of controller.  If this is REM Chem we
                    // will send the whole rest of the nut over to it.  Intellichem will only let us
                    // set specific values.
                    if (controller.type === 3) {

                    }
                }
            }
            catch (err) { logger.error(`Socket processing error /chemController: ${err.message}`); }
        });
        sock.on('/circuit', async (data: any) => {
            try {
                data = JSON.parse(data);
                let id = parseInt(data.id, 10);
                if (!isNaN(id) && typeof data.toggle !== 'undefined')
                    if (utils.makeBool(data.toggle)) await sys.board.circuits.toggleCircuitStateAsync(id);
                else if (!isNaN(id) && (typeof data.isOn !== 'undefined' || typeof data.state !== 'undefined')) {
                    await sys.board.circuits.setCircuitStateAsync(id, utils.makeBool(data.isOn || typeof data.state));
                }
            }
            catch (err) { logger.error(`Socket /circuit error: ${err.message}`); }
        });
        sock.on('/feature', async (data: any) => {
            try {
                data = JSON.parse(data);
                let id = parseInt(data.id, 10);
                if (!isNaN(id) && typeof data.toggle !== 'undefined')
                    if (utils.makeBool(data.toggle)) await sys.board.features.toggleFeatureStateAsync(id);
                if (!isNaN(id) && (typeof data.isOn !== 'undefined' || typeof data.state !== 'undefined')) {
                    await sys.board.features.setFeatureStateAsync(id, utils.makeBool(data.isOn || typeof data.state));
                }
            }
            catch (err) { logger.error(`Socket processing error /feature: ${err.message}`); }
        });
        sock.on('/circuitGroup', async (data: any) => {
            try {
                data = JSON.parse(data);
                let id = parseInt(data.id, 10);
                if (!isNaN(id) && (typeof data.isOn !== 'undefined' || typeof data.state !== 'undefined')) {
                    await sys.board.circuits.setCircuitGroupStateAsync(id, utils.makeBool(data.isOn || typeof data.state));
                }
            }
            catch (err) { logger.error(`Socket processing error /circuitGroup: ${err.message}`); }
        });
        sock.on('/lightGroup', async (data: any) => {
            try {
                data = JSON.parse(data);
                let id = parseInt(data.id, 10);
                if (!isNaN(id) && (typeof data.isOn !== 'undefined' || typeof data.state !== 'undefined')) {
                    await sys.board.circuits.setLightGroupStateAsync(id, utils.makeBool(data.isOn || typeof data.state));
                }
                if (!isNaN(id) && typeof data.theme !== 'undefined') await sys.board.circuits.setLightGroupThemeAsync(id, data.theme);
            }
            catch (err) { logger.error(`Socket processing error /lightGroup: ${err.message}`); }
        });
        sock.on('/panelMode', async (data: any) => {
            try {
                data = JSON.parse(data);
                let obj = {};
                if (typeof data.isOn !== 'undefined' && !utils.makeBool(data.isOn)) return; // This is just in case it is sent by REM for a toggle button.
                if (typeof data.timeout !== 'undefined' && !isNaN(data.timeout) && data.timeout) {
                    switch (data.timeUnits.toLowerCase()) {
                        case 'min':
                        case 'mins':
                        case 'm':
                        case 'minute':
                        case 'minutes':
                            data.timeout = data.timeout * 60;
                            break;
                        case 'hr':
                        case 'hrs':
                        case 'h':
                        case 'hour':
                            data.timeout = data.timeout * 3600;
                            break;
                    }
                }
                if (typeof data.mode === 'undefined' || data.mode === 'toggle') {
                    if (state.mode === 0) {
                        if (typeof data.timeout !== 'undefined' && !isNaN(data.timeout) && data.timeout)
                            data.mode = 'timeout';
                        else data.mode = 'service';
                        await sys.board.system.setPanelModeAsync(data);
                    }
                    else sys.board.system.setPanelModeAsync({ mode: 'auto' });
                }
                else await sys.board.system.setPanelModeAsync(data);
            } catch (err) { logger.error(`Socket processing error /panelMode: ${err.message}`); }
        });
        /*
        app.get('/state/chemController/:id', (req, res) => {
            res.status(200).send(state.chemControllers.getItemById(parseInt(req.params.id, 10)).getExtended());
        });
        app.get('/state/chlorinator/:id', (req, res) => {
            res.status(200).send(state.chlorinators.getItemById(parseInt(req.params.id, 10)).get());
        });
        app.get('/state/circuit/:id', (req, res) => {
            res.status(200).send(state.circuits.getItemById(parseInt(req.params.id, 10)).get());
        });
        app.get('/state/pump/:id', (req, res) => {
            // todo: need getInterfaceById.get() for features
            let pump = state.pumps.getItemById(parseInt(req.params.id, 10));
            return res.status(200).send(pump.getExtended());
        });
        app.put('/state/circuit/setState', async (req, res, next) => {
            try {
                console.log(`request:  ${JSON.stringify(req.body)}... id: ${req.body.id}  state: ${req.body.state}`);
                //state.circuits.setCircuitState(parseInt(req.body.id, 10), utils.makeBool(req.body.state));
                let circuit = await sys.board.circuits.setCircuitStateAsync(parseInt(req.body.id, 10), utils.makeBool(req.body.state));
                return res.status(200).send((circuit as ICircuitState).get(true));
            }
            catch (err) { next(err); }
        });
  
        app.put('/state/circuit/setTheme', async (req, res, next) => {
           try {
               let theme = await state.circuits.setLightThemeAsync(parseInt(req.body.id, 10), parseInt(req.body.theme, 10));
               return res.status(200).send(theme);
            } 
            catch (err) { next(err); }
        }); 

        app.put('/state/circuit/setDimmerLevel', async (req, res, next) => {
            try {
                let circuit = await sys.board.circuits.setDimmerLevelAsync(parseInt(req.body.id, 10), parseInt(req.body.level, 10));
                return res.status(200).send(circuit);
            }
            catch (err) { next(err); }
        });
        app.put('/state/feature/setState', async (req, res, next) => {
            try {
                await state.features.setFeatureStateAsync(req.body.id, req.body.state);
                return res.status(200).send('OK');
            }
            catch (err){ next(err); }
        });
        

        app.put('/state/chlorinator/setChlor', async (req, res, next) => {
            try {
                let chlor = await sys.board.chlorinator.setChlorAsync(req.body);
                return res.status(200).send(chlor);
            } catch (err) { next(err); }
        });
        app.put('/state/chlorinator/poolSetpoint', async (req, res, next) => {
            try {
                let obj = { id: req.body.id, poolSetpoint: parseInt(req.body.setPoint, 10) }
                let chlor = await sys.board.chlorinator.setChlorAsync(obj);
                return res.status(200).send(chlor);
            }
            catch (err) { next(err); }
        });
        app.put('/state/chlorinator/spaSetpoint', async (req, res, next) => {
            try {
                let obj = { id: req.body.id, spaSetpoint: parseInt(req.body.setPoint, 10) }
                let chlor = await sys.board.chlorinator.setChlorAsync(obj);
                return res.status(200).send(chlor);
            }
            catch (err) { next(err); }
        });
        app.put('/state/chlorinator/superChlorHours', async (req, res, next) => {
            try {
                let obj = { id: req.body.id, superChlorHours: parseInt(req.body.hours, 10) }
                let chlor = await sys.board.chlorinator.setChlorAsync(obj);
                return res.status(200).send(chlor);
            }
            catch (err) { next(err); }
        });
        app.put('/state/chlorinator/superChlorinate', async (req, res, next) => {
            try {
                let obj = { id: req.body.id, superChlorinate: utils.makeBool(req.body.superChlorinate) }
                let chlor = await sys.board.chlorinator.setChlorAsync(obj);
                return res.status(200).send(chlor);
            }
            catch (err) { next(err); }
        });
        app.put('/state/cancelDelay', (req, res) => {
            state.equipment.cancelDelay();
            return res.status(200).send('OK');
        });
        app.put('/state/lightGroup/:id/colorSync', async (req, res, next) => {
            try {
                let sgroup = await sys.board.circuits.sequenceLightGroupAsync(parseInt(req.params.id, 10), 'sync');
                return res.status(200).send(sgroup.get(true));
            }
            catch (err) { next(err); }
        });
        app.put('/state/lightGroup/:id/colorSet', async (req, res, next) => {
            try {
                let sgroup = await sys.board.circuits.sequenceLightGroupAsync(parseInt(req.params.id, 10), 'set');
                return res.status(200).send(sgroup.get(true));
            }
            catch (err) { next(err); }
        });
        app.put('/state/lightGroup/:id/colorSwim', async (req, res, next) => {
            try {
                let sgroup = await sys.board.circuits.sequenceLightGroupAsync(parseInt(req.params.id, 10), 'swim');
                return res.status(200).send(sgroup.get(true));
            }
            catch (err) { next(err); }
        });
        app.put('/state/chemController', async (req, res, next) => {
            try {
                let chem = await state.chemControllers.setChemControllerAsync(req.body);
                return res.status(200).send(chem.get(true));
            }
            catch (err) { next(err); }
        });

        app.get('/state/:section', (req, res) => {
            res.status(200).send(state.getState(req.params.section));
        });
        */
    }
}