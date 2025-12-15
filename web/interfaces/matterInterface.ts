// ABOUTME: Matter smart home interface for nodejs-poolController.
// ABOUTME: Exposes pool equipment as Matter-compatible devices for HomeKit, Google Home, Alexa integration.

import { logger } from "../../logger/Logger";
import { sys } from "../../controller/Equipment";
import { state } from "../../controller/State";
import { BaseInterfaceBindings, InterfaceContext } from "./baseInterface";

// Matter imports - these will be available after npm install
let ServerNode: any;
let Endpoint: any;
let OnOffLightDevice: any;
let OnOffPlugInUnitDevice: any;
let TemperatureSensorDevice: any;
let ThermostatDevice: any;

// Track if Matter is available
let matterAvailable = false;

// Attempt to load Matter dependencies
// Note: logger may not be initialized at module load time, so we use console for initial load messages
try {
    const matterMain = require("@matter/main");
    const matterDevices = require("@matter/main/devices");

    ServerNode = matterMain.ServerNode;
    Endpoint = matterMain.Endpoint;
    OnOffLightDevice = matterDevices.OnOffLightDevice;
    OnOffPlugInUnitDevice = matterDevices.OnOffPlugInUnitDevice;
    TemperatureSensorDevice = matterDevices.TemperatureSensorDevice;
    ThermostatDevice = matterDevices.ThermostatDevice;

    matterAvailable = true;
} catch (err) {
    // Matter dependencies not installed - this is fine, interface will be disabled
    matterAvailable = false;
}

export class MatterInterfaceBindings extends BaseInterfaceBindings {
    private server: any;
    private endpoints: Map<string, any> = new Map();
    private initialized: boolean = false;
    declare context: InterfaceContext;
    declare cfg: any;

    constructor(cfg: any) {
        super(cfg);
    }

    public async initAsync(): Promise<void> {
        if (!matterAvailable) {
            logger.error("Matter interface cannot start: @matter/main not installed");
            return;
        }

        try {
            logger.info(`Initializing Matter interface ${this.cfg.name}`);

            const opts = this.cfg.options || {};

            // Create Matter ServerNode (bridge)
            this.server = await ServerNode.create({
                id: opts.nodeId || "pool-controller-bridge",
                network: {
                    port: opts.port || 5540
                },
                commissioning: {
                    passcode: opts.passcode || 20202021,
                    discriminator: opts.discriminator || 3840,
                },
                productDescription: {
                    name: opts.name || sys.general.alias || "Pool Controller",
                    deviceType: 0x0016, // Root Node
                },
                basicInformation: {
                    vendorName: "nodejs-poolController",
                    vendorId: 0xFFF1, // Test vendor ID
                    productName: opts.name || sys.general.alias || "Pool Controller",
                    productId: 0x8001,
                    serialNumber: `njsPC-${sys.controllerType}`,
                    softwareVersion: 1,
                    softwareVersionString: "1.0.0",
                },
            });

            // Create endpoints for pool equipment
            await this.createEndpoints();

            // Start the server
            await this.server.start();
            this.initialized = true;

            logger.info(`Matter bridge started on port ${opts.port || 5540}`);
            logger.info(`Matter pairing code: ${opts.passcode || 20202021}`);
            logger.info(`Matter discriminator: ${opts.discriminator || 3840}`);

        } catch (err) {
            logger.error(`Error initializing Matter interface: ${err.message}`);
        }
    }

    private async createEndpoints(): Promise<void> {
        try {
            // Create circuit endpoints (lights, aux)
            for (let i = 0; i < state.circuits.length; i++) {
                const circuit = state.circuits.getItemByIndex(i);
                if (circuit && circuit.isActive !== false) {
                    await this.createCircuitEndpoint(circuit);
                }
            }

            // Create feature endpoints
            for (let i = 0; i < state.features.length; i++) {
                const feature = state.features.getItemByIndex(i);
                if (feature && feature.isActive !== false) {
                    await this.createFeatureEndpoint(feature);
                }
            }

            // Create pump endpoints
            for (let i = 0; i < state.pumps.length; i++) {
                const pump = state.pumps.getItemByIndex(i);
                if (pump) {
                    await this.createPumpEndpoint(pump);
                }
            }

            // Create temperature sensor endpoints
            await this.createTempEndpoints();

            // Create heater/thermostat endpoint for each body
            // NOTE: Heater endpoints disabled for now - ThermostatDevice requires
            // additional ThermostatServer behavior configuration in matter.js
            // TODO: Implement proper thermostat support
            // for (let i = 0; i < state.temps.bodies.length; i++) {
            //     const body = state.temps.bodies.getItemByIndex(i);
            //     if (body) {
            //         await this.createHeaterEndpoint(body);
            //     }
            // }

            logger.info(`Created ${this.endpoints.size} Matter endpoints`);
        } catch (err) {
            logger.error(`Error creating Matter endpoints: ${err.message}`);
        }
    }

    private async createCircuitEndpoint(circuit: any): Promise<void> {
        try {
            const endpointId = `circuit-${circuit.id}`;
            const deviceName = circuit.name || `Circuit ${circuit.id}`;

            const endpoint = new Endpoint(OnOffLightDevice, {
                id: endpointId,
                onOff: {
                    onOff: circuit.isOn === true
                },
            });

            // Add endpoint to server first
            await this.server.add(endpoint);
            this.endpoints.set(endpointId, endpoint);

            // Subscribe to events after endpoint is added
            if (endpoint.events?.onOff?.onOff$Changed) {
                endpoint.events.onOff.onOff$Changed.on(async (value: boolean) => {
                    try {
                        logger.info(`Matter: Circuit ${circuit.id} (${circuit.name}) commanded to ${value ? 'on' : 'off'}`);
                        await sys.board.circuits.setCircuitStateAsync(circuit.id, value);
                    } catch (err) {
                        logger.error(`Matter: Error setting circuit ${circuit.id}: ${err.message}`);
                    }
                });
            }

            logger.debug(`Created Matter endpoint for circuit: ${circuit.name} (${circuit.id})`);
        } catch (err) {
            logger.error(`Error creating circuit endpoint ${circuit.id}: ${err.message}`);
        }
    }

    private async createFeatureEndpoint(feature: any): Promise<void> {
        try {
            const endpointId = `feature-${feature.id}`;
            const deviceName = feature.name || `Feature ${feature.id}`;

            const endpoint = new Endpoint(OnOffLightDevice, {
                id: endpointId,
                onOff: {
                    onOff: feature.isOn === true
                },
            });

            // Add endpoint to server first
            await this.server.add(endpoint);
            this.endpoints.set(endpointId, endpoint);

            // Subscribe to events after endpoint is added
            if (endpoint.events?.onOff?.onOff$Changed) {
                endpoint.events.onOff.onOff$Changed.on(async (value: boolean) => {
                    try {
                        logger.info(`Matter: Feature ${feature.id} (${feature.name}) commanded to ${value ? 'on' : 'off'}`);
                        await sys.board.features.setFeatureStateAsync(feature.id, value);
                    } catch (err) {
                        logger.error(`Matter: Error setting feature ${feature.id}: ${err.message}`);
                    }
                });
            }

            logger.debug(`Created Matter endpoint for feature: ${feature.name} (${feature.id})`);
        } catch (err) {
            logger.error(`Error creating feature endpoint ${feature.id}: ${err.message}`);
        }
    }

    private async createPumpEndpoint(pump: any): Promise<void> {
        try {
            const endpointId = `pump-${pump.id}`;
            const deviceName = pump.name || `Pump ${pump.id}`;

            // Pump is "on" if it's running (rpm > 0 or watts > 0)
            const isRunning = (pump.rpm && pump.rpm > 0) || (pump.watts && pump.watts > 0);

            const endpoint = new Endpoint(OnOffPlugInUnitDevice, {
                id: endpointId,
                onOff: {
                    onOff: isRunning
                },
            });

            // Add endpoint to server first
            await this.server.add(endpoint);
            this.endpoints.set(endpointId, endpoint);

            // Subscribe to events after endpoint is added
            if (endpoint.events?.onOff?.onOff$Changed) {
                endpoint.events.onOff.onOff$Changed.on(async (value: boolean) => {
                    try {
                        logger.info(`Matter: Pump ${pump.id} commanded to ${value ? 'on' : 'off'}`);
                        // Pumps are controlled via their associated circuits
                        // Find the first circuit associated with this pump
                        const pumpConfig = sys.pumps.getItemById(pump.id);
                        if (pumpConfig && pumpConfig.circuits && pumpConfig.circuits.length > 0) {
                            const circuitId = pumpConfig.circuits.getItemByIndex(0).circuit;
                            await sys.board.circuits.setCircuitStateAsync(circuitId, value);
                        } else {
                            logger.warn(`Matter: No circuit found for pump ${pump.id}`);
                        }
                    } catch (err) {
                        logger.error(`Matter: Error setting pump ${pump.id}: ${err.message}`);
                    }
                });
            }

            logger.debug(`Created Matter endpoint for pump: ${pump.name} (${pump.id})`);
        } catch (err) {
            logger.error(`Error creating pump endpoint ${pump.id}: ${err.message}`);
        }
    }

    private async createTempEndpoints(): Promise<void> {
        try {
            // Create water temperature sensors for each body
            for (let i = 0; i < state.temps.bodies.length; i++) {
                const body = state.temps.bodies.getItemByIndex(i);
                if (body && typeof body.temp !== 'undefined') {
                    const endpointId = `temp-water-${body.id}`;

                    const endpoint = new Endpoint(TemperatureSensorDevice, {
                        id: endpointId,
                        temperatureMeasurement: {
                            measuredValue: this.toMatterTemp(body.temp)
                        },
                    });

                    await this.server.add(endpoint);
                    this.endpoints.set(endpointId, endpoint);
                    logger.debug(`Created Matter temperature endpoint for body: ${body.name} (${body.id})`);
                }
            }

            // Create air temperature sensor if available
            if (typeof state.temps.air !== 'undefined' && state.temps.air !== null) {
                const endpointId = "temp-air";

                const endpoint = new Endpoint(TemperatureSensorDevice, {
                    id: endpointId,
                    temperatureMeasurement: {
                        measuredValue: this.toMatterTemp(state.temps.air)
                    },
                });

                await this.server.add(endpoint);
                this.endpoints.set(endpointId, endpoint);
                logger.debug(`Created Matter temperature endpoint for air`);
            }

            // Create solar temperature sensor if available
            if (typeof state.temps.solar !== 'undefined' && state.temps.solar !== null) {
                const endpointId = "temp-solar";

                const endpoint = new Endpoint(TemperatureSensorDevice, {
                    id: endpointId,
                    temperatureMeasurement: {
                        measuredValue: this.toMatterTemp(state.temps.solar)
                    },
                });

                await this.server.add(endpoint);
                this.endpoints.set(endpointId, endpoint);
                logger.debug(`Created Matter temperature endpoint for solar`);
            }
        } catch (err) {
            logger.error(`Error creating temperature endpoints: ${err.message}`);
        }
    }

    private async createHeaterEndpoint(body: any): Promise<void> {
        try {
            const endpointId = `heater-${body.id}`;

            const endpoint = new Endpoint(ThermostatDevice, {
                id: endpointId,
                bridgedDeviceBasicInformation: {
                    vendorName: "nodejs-poolController",
                    productName: `${body.name || 'Pool'} Heater`,
                    nodeLabel: `${body.name || 'Pool'} Heater`,
                    serialNumber: `heater-${body.id}`,
                    reachable: true,
                },
                thermostat: {
                    // Heating only mode
                    controlSequenceOfOperation: 2, // HeatingOnly
                    systemMode: body.heatMode && body.heatMode.val > 1 ? 4 : 0, // Heat or Off
                    localTemperature: this.toMatterTemp(body.temp || 70),
                    occupiedHeatingSetpoint: this.toMatterTemp(body.setPoint || 80),
                    minHeatSetpointLimit: this.toMatterTemp(50),
                    maxHeatSetpointLimit: this.toMatterTemp(104),
                }
            });

            // Add endpoint to server first
            await this.server.add(endpoint);
            this.endpoints.set(endpointId, endpoint);

            // Subscribe to events after endpoint is added
            if (endpoint.events?.thermostat?.systemMode$Changed) {
                endpoint.events.thermostat.systemMode$Changed.on(async (value: number) => {
                    try {
                        // 0 = Off, 4 = Heat
                        const modeName = value === 4 ? 'heater' : 'off';
                        logger.info(`Matter: Heater ${body.id} mode commanded to ${modeName}`);
                        const modeVal = sys.board.valueMaps.heatModes.getValue(modeName);
                        if (typeof modeVal !== 'undefined') {
                            await sys.board.bodies.setHeatModeAsync(body, modeVal);
                        }
                    } catch (err) {
                        logger.error(`Matter: Error setting heater mode for body ${body.id}: ${err.message}`);
                    }
                });
            }

            if (endpoint.events?.thermostat?.occupiedHeatingSetpoint$Changed) {
                endpoint.events.thermostat.occupiedHeatingSetpoint$Changed.on(async (value: number) => {
                    try {
                        const tempF = this.fromMatterTemp(value);
                        logger.info(`Matter: Heater ${body.id} setpoint commanded to ${tempF}°F`);
                        await sys.board.bodies.setHeatSetpointAsync(body, tempF);
                    } catch (err) {
                        logger.error(`Matter: Error setting heater setpoint for body ${body.id}: ${err.message}`);
                    }
                });
            }

            logger.debug(`Created Matter heater endpoint for body: ${body.name} (${body.id})`);
        } catch (err) {
            logger.error(`Error creating heater endpoint ${body.id}: ${err.message}`);
        }
    }

    // Matter uses centidegrees Celsius (e.g., 2500 = 25.00°C)
    private toMatterTemp(temp: number): number {
        if (typeof temp !== 'number' || isNaN(temp)) return 2000; // Default 20°C

        // Check if units are Fahrenheit (0) or Celsius (1)
        if (state.temps.units === 0) {
            // Fahrenheit to Celsius, then to centidegrees
            return Math.round(((temp - 32) * 5 / 9) * 100);
        }
        return Math.round(temp * 100);
    }

    private fromMatterTemp(matterTemp: number): number {
        const celsius = matterTemp / 100;
        // Check if units are Fahrenheit (0) or Celsius (1)
        if (state.temps.units === 0) {
            // Celsius to Fahrenheit
            return Math.round((celsius * 9 / 5) + 32);
        }
        return Math.round(celsius);
    }

    public bindEvent(evt: string, ...data: any): void {
        if (!this.initialized || !this.server) return;

        const item = data[0];
        if (!item) return;

        try {
            switch (evt) {
                case 'circuit':
                    this.updateCircuit(item);
                    break;
                case 'feature':
                    this.updateFeature(item);
                    break;
                case 'pump':
                    this.updatePump(item);
                    break;
                case 'temps':
                    this.updateTemps(item);
                    break;
                case 'body':
                    this.updateBody(item);
                    break;
            }
        } catch (err) {
            logger.error(`Matter: Error handling event ${evt}: ${err.message}`);
        }
    }

    private async updateCircuit(circuit: any): Promise<void> {
        const endpoint = this.endpoints.get(`circuit-${circuit.id}`);
        if (endpoint) {
            try {
                await endpoint.set({ onOff: { onOff: circuit.isOn === true } });
                logger.debug(`Matter: Updated circuit ${circuit.id} to ${circuit.isOn}`);
            } catch (err) {
                logger.error(`Matter: Error updating circuit ${circuit.id}: ${err.message}`);
            }
        }
    }

    private async updateFeature(feature: any): Promise<void> {
        const endpoint = this.endpoints.get(`feature-${feature.id}`);
        if (endpoint) {
            try {
                await endpoint.set({ onOff: { onOff: feature.isOn === true } });
                logger.debug(`Matter: Updated feature ${feature.id} to ${feature.isOn}`);
            } catch (err) {
                logger.error(`Matter: Error updating feature ${feature.id}: ${err.message}`);
            }
        }
    }

    private async updatePump(pump: any): Promise<void> {
        const endpoint = this.endpoints.get(`pump-${pump.id}`);
        if (endpoint) {
            try {
                const isRunning = (pump.rpm && pump.rpm > 0) || (pump.watts && pump.watts > 0);
                await endpoint.set({ onOff: { onOff: isRunning } });
                logger.debug(`Matter: Updated pump ${pump.id} to ${isRunning}`);
            } catch (err) {
                logger.error(`Matter: Error updating pump ${pump.id}: ${err.message}`);
            }
        }
    }

    private async updateTemps(temps: any): Promise<void> {
        try {
            // Update body temperatures
            if (temps.bodies) {
                for (let i = 0; i < temps.bodies.length; i++) {
                    const body = temps.bodies[i] || temps.bodies.getItemByIndex?.(i);
                    if (body) {
                        const endpoint = this.endpoints.get(`temp-water-${body.id}`);
                        if (endpoint && typeof body.temp !== 'undefined') {
                            await endpoint.set({
                                temperatureMeasurement: {
                                    measuredValue: this.toMatterTemp(body.temp)
                                }
                            });
                        }
                    }
                }
            }

            // Update air temperature
            if (typeof temps.air !== 'undefined') {
                const endpoint = this.endpoints.get("temp-air");
                if (endpoint) {
                    await endpoint.set({
                        temperatureMeasurement: {
                            measuredValue: this.toMatterTemp(temps.air)
                        }
                    });
                }
            }

            // Update solar temperature
            if (typeof temps.solar !== 'undefined') {
                const endpoint = this.endpoints.get("temp-solar");
                if (endpoint) {
                    await endpoint.set({
                        temperatureMeasurement: {
                            measuredValue: this.toMatterTemp(temps.solar)
                        }
                    });
                }
            }
        } catch (err) {
            logger.error(`Matter: Error updating temperatures: ${err.message}`);
        }
    }

    private async updateBody(body: any): Promise<void> {
        try {
            // Update heater endpoint
            const heaterEndpoint = this.endpoints.get(`heater-${body.id}`);
            if (heaterEndpoint) {
                const updates: any = {
                    thermostat: {}
                };

                if (typeof body.temp !== 'undefined') {
                    updates.thermostat.localTemperature = this.toMatterTemp(body.temp);
                }
                if (typeof body.setPoint !== 'undefined') {
                    updates.thermostat.occupiedHeatingSetpoint = this.toMatterTemp(body.setPoint);
                }
                if (body.heatMode) {
                    // heatMode.val > 1 means heating is enabled
                    updates.thermostat.systemMode = body.heatMode.val > 1 ? 4 : 0;
                }

                if (Object.keys(updates.thermostat).length > 0) {
                    await heaterEndpoint.set(updates);
                    logger.debug(`Matter: Updated heater ${body.id}`);
                }
            }

            // Also update the water temperature sensor
            const tempEndpoint = this.endpoints.get(`temp-water-${body.id}`);
            if (tempEndpoint && typeof body.temp !== 'undefined') {
                await tempEndpoint.set({
                    temperatureMeasurement: {
                        measuredValue: this.toMatterTemp(body.temp)
                    }
                });
            }
        } catch (err) {
            logger.error(`Matter: Error updating body ${body.id}: ${err.message}`);
        }
    }

    public async stopAsync(): Promise<void> {
        try {
            if (this.server) {
                logger.info("Stopping Matter interface");
                await this.server.close();
                this.server = null;
                this.endpoints.clear();
                this.initialized = false;
            }
        } catch (err) {
            logger.error(`Error stopping Matter interface: ${err.message}`);
        }
    }
}
