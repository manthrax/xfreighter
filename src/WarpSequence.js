export async function executeWarpSequence(deps) {
    const {
        wp,
        currentLatticePos,
        universe,
        sectorManager,
        starMap,
        flightController,
        hud,
        nebularity,
        tts,
        nameGen,
        scene
    } = deps;

    const isCorrectTarget = wp.isCourseTarget;

    const oldLatticePos = { ...currentLatticePos };
    const newLatticePos = wp.targetLatticePos;
    sectorManager.lockedGateCoords = oldLatticePos; // Lock the return gate

    const newSector = universe.getSector(newLatticePos.ix, newLatticePos.iy, newLatticePos.iz);
    universe.visitedSectors.add(newSector.id);

    // Prevent double triggers by clearing immediately
    sectorManager.warpPoints.forEach(p => p.dispose(scene));
    sectorManager.warpPoints = [];
    hud.pois = [];

    if (starMap.plannedPath.length > 1 && isCorrectTarget) {
        starMap.plannedPath.shift();
        if (starMap.plannedPath.length <= 1) {
            starMap.selectedSector = null;
            starMap.plannedPath = [];
            flightController.autopilot = false;
            flightController.cameraLocked = false;
            flightController.autopilotTarget = null;
            flightController.throttle.set(0, 0, 0);
            flightController.isHyperThrusting = false;
            document.getElementById('map-sidebar').classList.add('hidden');
            hud.addMessage("COURSE COMPLETE. DESTINATION REACHED.");
        } else {
            starMap.onSectorSelected(starMap.selectedSector, starMap.plannedPath);
        }
    } else if (!isCorrectTarget) {
        if (flightController.autopilot && starMap.selectedSector) {
            hud.addMessage("OFF COURSE. RE-CALCULATING PATH TO DESTINATION...");
            starMap.currentSectorOrigin = newSector;
            starMap.calculatePath(); // Re-calculate from new position

            // If we couldn't find a path from here, then we give up
            if (starMap.plannedPath.length <= 1) {
                hud.addMessage("AUTOPILOT ERROR: DESTINATION UNREACHABLE FROM CURRENT NODE.");
                flightController.autopilot = false;
                flightController.cameraLocked = false;
            }
        } else {
            starMap.plannedPath = [];
            starMap.selectedSector = null;
            flightController.autopilot = false;
            flightController.cameraLocked = false;
            document.getElementById('map-sidebar').classList.add('hidden');
        }
    }

    const transDuration = 8.0;
    setTimeout(() => nebularity.morph(newSector.seed, { duration: transDuration * .5 }), transDuration * .5);
    flightController.triggerWarp(transDuration);
    hud.addMessage(`INITIATING HYPERSPACE JUMP...`);
    hud.addMessage(`TRANSITIONING TO NODE: ${newSector.id.toUpperCase()}...`);

    const sectorName = nameGen.getName(newSector.seed, 'sector');

    // Start voice-over in background to mask the journey
    (async () => {
        await tts.speak(`Entering ${sectorName}.`, { voice: 'af_alloy', speed: 1 });
        const attr = newSector.attributes;
        const summary = `Luminosity: ${attr.luminosity}. Stability: ${attr.stability}. Resource density: ${attr.resources}.`;
        await tts.speak(summary, { voice: 'af_river', speed: 1 });
    })();

    await sectorManager.spawn(newSector, true);

    if (flightController.autopilot) {
        flightController.autopilotTarget = null;
        if (starMap.plannedPath.length > 1) {
            const nextSector = starMap.plannedPath[1];
            const nextWP = sectorManager.warpPoints.find(p =>
                p.targetLatticePos.ix === nextSector.coords.ix &&
                p.targetLatticePos.iy === nextSector.coords.iy &&
                p.targetLatticePos.iz === nextSector.coords.iz
            );
            if (nextWP) flightController.autopilotTarget = nextWP.position;
        }
    }

    starMap.refresh(newSector);

    return { newLatticePos, newSector };
}
