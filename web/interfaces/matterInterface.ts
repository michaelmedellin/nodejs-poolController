// ABOUTME: Matter smart home interface for nodejs-poolController.
// ABOUTME: Exposes pool equipment as Matter-compatible devices for HomeKit, Google Home, Alexa integration.

import { logger } from "../../logger/Logger";
import { sys } from "../../controller/Equipment";
import { state } from "../../controller/State";
import { BaseInterfaceBindings, InterfaceContext } from "./baseInterface";

// Matter imports - these will be available after npm install
let ServerNode: any;
let Endpoint: any;
let AggregatorEndpoint: any;
let BridgedDeviceBasicInformationServer: any;
let OnOffLightDevice: any;
let OnOffPlugInUnitDevice: any;
let TemperatureSensorDevice: any;
let ThermostatDevice: any;
let Thermostat: any; // Cluster definition for enums (SystemMode, ControlSequenceOfOperation)

// Bridged device types (composed with BridgedDeviceBasicInformationServer)
let BridgedOnOffLight: any;
let BridgedOnOffPlugInUnit: any;
let BridgedTemperatureSensor: any;
let BridgedThermostat: any;

// Track if Matter is available
let matterAvailable = false;

// Attempt to load Matter dependencies
// Note: logger may not be initialized at module load time, so we use console for initial load messages
try {
    const matterMain = require("@matter/main");
    const matterDevices = require("@matter/main/devices");
    const matterEndpoints = require("@matter/main/endpoints");
    const matterBehaviors = require("@matter/main/behaviors");
    const matterClusters = require("@matter/main/clusters");

    ServerNode = matterMain.ServerNode;
    Endpoint = matterMain.Endpoint;
    AggregatorEndpoint = matterEndpoints.AggregatorEndpoint;
    BridgedDeviceBasicInformationServer = matterBehaviors.BridgedDeviceBasicInformationServer;
    OnOffLightDevice = matterDevices.OnOffLightDevice;
    OnOffPlugInUnitDevice = matterDevices.OnOffPlugInUnitDevice;
    TemperatureSensorDevice = matterDevices.TemperatureSensorDevice;
    ThermostatDevice = matterDevices.ThermostatDevice;
    Thermostat = matterClusters.Thermostat;

    // Compose device types with BridgedDeviceBasicInformationServer for proper naming
    BridgedOnOffLight = OnOffLightDevice.with(BridgedDeviceBasicInformationServer);
    BridgedOnOffPlugInUnit = OnOffPlugInUnitDevice.with(BridgedDeviceBasicInformationServer);
    BridgedTemperatureSensor = TemperatureSensorDevice.with(BridgedDeviceBasicInformationServer);
    BridgedThermostat = ThermostatDevice.with(BridgedDeviceBasicInformationServer);

    matterAvailable = true;
} catch (err) {
    // Matter dependencies not installed - this is fine, interface will be disabled
    matterAvailable = false;
}

export class MatterInterfaceBindings extends BaseInterfaceBindings {
    private server: any;
    private aggregator: any;
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

            // Create Matter ServerNode (bridge root)
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

            // Create Aggregator endpoint - this is the bridge container for all devices
            this.aggregator = new Endpoint(AggregatorEndpoint, {
                id: "bridge-aggregator"
            });
            await this.server.add(this.aggregator);

            // Create bridged endpoints for pool equipment
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
            for (let i = 0; i < state.temps.bodies.length; i++) {
                const body = state.temps.bodies.getItemByIndex(i);
                if (body) {
                    await this.createHeaterEndpoint(body);
                }
            }

            logger.info(`Created ${this.endpoints.size} Matter endpoints`);
        } catch (err) {
            logger.error(`Error creating Matter endpoints: ${err.message}`);
        }
    }

    private async createCircuitEndpoint(circuit: any): Promise<void> {
        try {
            const endpointId = `circuit-${circuit.id}`;
            const deviceName = circuit.name || `Circuit ${circuit.id}`;

            const endpoint = new Endpoint(BridgedOnOffLight, {
                id: endpointId,
                bridgedDeviceBasicInformation: {
                    nodeLabel: deviceName,
                    productName: deviceName,
                    productLabel: deviceName,
                    serialNumber: `circuit-${circuit.id}`,
                    reachable: true,
                },
                onOff: {
                    onOff: circuit.isOn === true
                },
            });

            // Add endpoint to the aggregator (not the server)
            await this.aggregator.add(endpoint);
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

            logger.debug(`Created Matter endpoint for circuit: ${deviceName} (${circuit.id})`);
        } catch (err) {
            logger.error(`Error creating circuit endpoint ${circuit.id}: ${err.message}`);
        }
    }

    private async createFeatureEndpoint(feature: any): Promise<void> {
        try {
            const endpointId = `feature-${feature.id}`;
            const deviceName = feature.name || `Feature ${feature.id}`;

            const endpoint = new Endpoint(BridgedOnOffLight, {
                id: endpointId,
                bridgedDeviceBasicInformation: {
                    nodeLabel: deviceName,
                    productName: deviceName,
                    productLabel: deviceName,
                    serialNumber: `feature-${feature.id}`,
                    reachable: true,
                },
                onOff: {
                    onOff: feature.isOn === true
                },
            });

            // Add endpoint to the aggregator (not the server)
            await this.aggregator.add(endpoint);
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

            logger.debug(`Created Matter endpoint for feature: ${deviceName} (${feature.id})`);
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

            const endpoint = new Endpoint(BridgedOnOffPlugInUnit, {
                id: endpointId,
                bridgedDeviceBasicInformation: {
                    nodeLabel: deviceName,
                    productName: deviceName,
                    productLabel: deviceName,
                    serialNumber: `pump-${pump.id}`,
                    reachable: true,
                },
                onOff: {
                    onOff: isRunning
                },
            });

            // Add endpoint to the aggregator (not the server)
            await this.aggregator.add(endpoint);
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

            logger.debug(`Created Matter endpoint for pump: ${deviceName} (${pump.id})`);
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
                    const deviceName = `${body.name || 'Water'} Temp`;

                    const endpoint = new Endpoint(BridgedTemperatureSensor, {
                        id: endpointId,
                        bridgedDeviceBasicInformation: {
                            nodeLabel: deviceName,
                            productName: deviceName,
                            productLabel: deviceName,
                            serialNumber: `temp-water-${body.id}`,
                            reachable: true,
                        },
                        temperatureMeasurement: {
                            measuredValue: this.toMatterTemp(body.temp)
                        },
                    });

                    await this.aggregator.add(endpoint);
                    this.endpoints.set(endpointId, endpoint);
                    logger.debug(`Created Matter temperature endpoint: ${deviceName} (${body.id})`);
                }
            }

            // Create air temperature sensor if available
            if (typeof state.temps.air !== 'undefined' && state.temps.air !== null) {
                const endpointId = "temp-air";
                const deviceName = "Air Temp";

                const endpoint = new Endpoint(BridgedTemperatureSensor, {
                    id: endpointId,
                    bridgedDeviceBasicInformation: {
                        nodeLabel: deviceName,
                        productName: deviceName,
                        productLabel: deviceName,
                        serialNumber: "temp-air",
                        reachable: true,
                    },
                    temperatureMeasurement: {
                        measuredValue: this.toMatterTemp(state.temps.air)
                    },
                });

                await this.aggregator.add(endpoint);
                this.endpoints.set(endpointId, endpoint);
                logger.debug(`Created Matter temperature endpoint: ${deviceName}`);
            }

            // Create solar temperature sensor if available
            if (typeof state.temps.solar !== 'undefined' && state.temps.solar !== null) {
                const endpointId = "temp-solar";
                const deviceName = "Solar Temp";

                const endpoint = new Endpoint(BridgedTemperatureSensor, {
                    id: endpointId,
                    bridgedDeviceBasicInformation: {
                        nodeLabel: deviceName,
                        productName: deviceName,
                        productLabel: deviceName,
                        serialNumber: "temp-solar",
                        reachable: true,
                    },
                    temperatureMeasurement: {
                        measuredValue: this.toMatterTemp(state.temps.solar)
                    },
                });

                await this.aggregator.add(endpoint);
                this.endpoints.set(endpointId, endpoint);
                logger.debug(`Created Matter temperature endpoint: ${deviceName}`);
            }
        } catch (err) {
            logger.error(`Error creating temperature endpoints: ${err.message}`);
        }
    }

    private async createHeaterEndpoint(body: any): Promise<void> {
        try {
            // Only create thermostat if body has a setpoint (implies it's heatable)
            if (typeof body.setPoint === 'undefined') {
                logger.debug(`Skipping heater endpoint for body ${body.id} - no setpoint`);
                return;
            }

            const endpointId = `thermostat-${body.id}`;
            const deviceName = `${body.name || 'Pool'} Heater`;

            // Determine current heating mode
            // heatStatus.val > 0 means actively heating, heatMode.val > 0 means heating enabled
            const isHeating = body.heatStatus && body.heatStatus.val > 0;
            const currentMode = isHeating ? Thermostat.SystemMode.Heat : Thermostat.SystemMode.Off;

            const endpoint = new Endpoint(BridgedThermostat, {
                id: endpointId,
                bridgedDeviceBasicInformation: {
                    nodeLabel: deviceName,
                    productName: "Pool Heater",
                    productLabel: "Pool Heater",
                    serialNumber: `heat-${body.id}`,
                    reachable: true,
                },
                thermostat: {
                    localTemperature: this.toMatterTemp(body.temp),
                    occupiedHeatingSetpoint: this.toMatterTemp(body.setPoint),
                    systemMode: currentMode,
                    controlSequenceOfOperation: Thermostat.ControlSequenceOfOperation.HeatingOnly,
                    minHeatSetpointLimit: this.toMatterTemp(40),
                    maxHeatSetpointLimit: this.toMatterTemp(104),
                }
            });

            // Add endpoint to the aggregator (not the server)
            await this.aggregator.add(endpoint);
            this.endpoints.set(endpointId, endpoint);

            // Handle setpoint changes from Matter controller
            if (endpoint.events?.thermostat?.occupiedHeatingSetpoint$Change) {
                endpoint.events.thermostat.occupiedHeatingSetpoint$Change.on(async (newValue: number) => {
                    try {
                        const newTempF = this.fromMatterTemp(newValue);
                        logger.info(`Matter: Setting ${body.name} setpoint to ${newTempF}°F`);
                        await sys.board.bodies.setHeatSetpointAsync(body, newTempF);
                    } catch (err) {
                        logger.error(`Matter: Error setting heater setpoint for body ${body.id}: ${err.message}`);
                    }
                });
            }

            // Handle mode changes from Matter controller (Off or Heat)
            if (endpoint.events?.thermostat?.systemMode$Change) {
                endpoint.events.thermostat.systemMode$Change.on(async (newMode: number) => {
                    try {
                        logger.info(`Matter: Changing ${body.name} heater mode to ${newMode}`);
                        if (newMode === Thermostat.SystemMode.Off) {
                            // Disable heater
                            const modeVal = sys.board.valueMaps.heatModes.getValue('off');
                            if (typeof modeVal !== 'undefined') {
                                await sys.board.bodies.setHeatModeAsync(body, modeVal);
                            }
                        } else if (newMode === Thermostat.SystemMode.Heat) {
                            // Enable heater
                            const modeVal = sys.board.valueMaps.heatModes.getValue('heater');
                            if (typeof modeVal !== 'undefined') {
                                await sys.board.bodies.setHeatModeAsync(body, modeVal);
                            }
                        }
                    } catch (err) {
                        logger.error(`Matter: Error setting heater mode for body ${body.id}: ${err.message}`);
                    }
                });
            }

            logger.debug(`Created Matter thermostat for: ${deviceName} (${body.id})`);
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
            // Update thermostat endpoint
            const thermostatEndpoint = this.endpoints.get(`thermostat-${body.id}`);
            if (thermostatEndpoint) {
                const updates: any = {
                    thermostat: {}
                };

                if (typeof body.temp !== 'undefined') {
                    updates.thermostat.localTemperature = this.toMatterTemp(body.temp);
                }
                if (typeof body.setPoint !== 'undefined') {
                    updates.thermostat.occupiedHeatingSetpoint = this.toMatterTemp(body.setPoint);
                }
                if (body.heatStatus) {
                    // heatStatus.val > 0 means actively heating
                    const isHeating = body.heatStatus.val > 0;
                    updates.thermostat.systemMode = isHeating ? Thermostat.SystemMode.Heat : Thermostat.SystemMode.Off;
                }

                if (Object.keys(updates.thermostat).length > 0) {
                    await thermostatEndpoint.set(updates);
                    logger.debug(`Matter: Updated thermostat ${body.id}`);
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
