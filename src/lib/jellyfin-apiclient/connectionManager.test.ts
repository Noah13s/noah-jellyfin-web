import { describe, expect, it, vi } from 'vitest';
import ConnectionManager from './connectionManager';
import { ConnectionState } from './connectionState';

// Connection negotiation is tested here; SDK construction/globalization is not
// needed until a real API client is created after a successful server response.
vi.mock('utils/jellyfin-apiclient/compat', () => ({ toApi: vi.fn(), updateApiClientSdk: vi.fn() }));
vi.mock('utils/jellyfin-apiclient/createApiClient', () => ({ createApiClient: vi.fn() }));

const manager = () => new ConnectionManager({ credentials: () => ({ Servers: [] }) }, 'Test', '1', 'Device', 'id', {});

describe('address connection failures', () => {
    it('rejects missing addresses with an actionable Error', async () => {
        await expect(manager().connectToAddress('')).rejects.toThrow('A server address is required');
    });

    it('tries HTTP once after unavailable HTTPS and returns the existing unavailable state', async () => {
        const client = manager();
        const connect = vi.spyOn(client, 'connectToServer').mockResolvedValue({ State: ConnectionState.Unavailable });
        expect(await client.connectToAddress('server.example/base')).toEqual({ State: ConnectionState.Unavailable });
        expect(connect.mock.calls.map(([server]) => server.ManualAddress)).toEqual([
            'https://server.example/base', 'http://server.example/base'
        ]);
    });

    it('does not retry a successful connection or add fallback for an explicit protocol', async () => {
        const client = manager();
        const connect = vi.spyOn(client, 'connectToServer').mockResolvedValue({ State: ConnectionState.SignedIn });
        expect(await client.connectToAddress('server.example')).toEqual({ State: ConnectionState.SignedIn });
        expect(connect).toHaveBeenCalledTimes(1);
        connect.mockClear().mockResolvedValue({ State: ConnectionState.Unavailable });
        await client.connectToAddress('https://server.example/base');
        expect(connect).toHaveBeenCalledTimes(1);
    });
});
