/**
 * EconomyManager: Handles procedural market prices and player inventory.
 */
export default class EconomyManager {
    constructor() {
        this.credits = 1000;
        this.inventory = new Map(); // itemName -> quantity
        this.commodities = [
            { id: 'fuel', name: 'Hydrogen Fuel', basePrice: 50, volatility: 0.4 },
            { id: 'minerals', name: 'Raw Minerals', basePrice: 120, volatility: 0.6 },
            { id: 'tech', name: 'Neural Tech', basePrice: 500, volatility: 0.8 },
            { id: 'luxuries', name: 'Exotic Luxuries', basePrice: 1200, volatility: 0.9 }
        ];
    }

    /**
     * Get prices for a specific sector based on its seed.
     */
    getMarketPrices(sectorSeed) {
        const prices = {};
        const rng = this._getRNG(sectorSeed);

        this.commodities.forEach(item => {
            const variance = (rng() - 0.5) * 2 * item.volatility;
            const price = Math.round(item.basePrice * (1 + variance));
            prices[item.id] = {
                id: item.id,
                name: item.name,
                buyPrice: price,
                sellPrice: Math.round(price * 0.85) // 15% spread
            };
        });

        return prices;
    }

    buy(itemId, quantity, price) {
        const total = price * quantity;
        if (this.credits >= total) {
            this.credits -= total;
            const current = this.inventory.get(itemId) || 0;
            this.inventory.set(itemId, current + quantity);
            return true;
        }
        return false;
    }

    sell(itemId, quantity, price) {
        const current = this.inventory.get(itemId) || 0;
        if (current >= quantity) {
            this.credits += price * quantity;
            this.inventory.set(itemId, current - quantity);
            if (this.inventory.get(itemId) === 0) this.inventory.delete(itemId);
            return true;
        }
        return false;
    }

    getState() {
        return {
            credits: this.credits,
            inventory: Array.from(this.inventory.entries())
        };
    }

    restoreState(state) {
        if (!state) return;
        this.credits = state.credits || 1000;
        this.inventory = new Map(state.inventory || []);
    }

    _getRNG(seedStr) {
        let hash = 0;
        for (let i = 0; i < seedStr.length; i++) hash = (hash << 5) - hash + seedStr.charCodeAt(i);
        return () => {
            hash = (hash * 1664525 + 1013904223) % 4294967296;
            return Math.abs(hash / 4294967296);
        };
    }
}
