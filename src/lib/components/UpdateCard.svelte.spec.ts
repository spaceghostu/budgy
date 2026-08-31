import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { UpdateState } from '../desktop/update.ts';

/**
 * The card asks a shell that only exists in the desktop app, so the module it
 * asks through is mocked. `isSettling` is deliberately left real — it is the
 * predicate under test here, and stubbing it would test the stub.
 */
const { isSettling } =
	await vi.importActual<typeof import('../desktop/update.ts')>('../desktop/update.ts');

const updateStatus = vi.fn<() => Promise<UpdateState>>();
const checkForUpdates = vi.fn<() => Promise<UpdateState>>();

vi.mock('../desktop/update.ts', () => ({
	isDesktop: () => true,
	isSettling: (phase: UpdateState['phase']) => isSettling(phase),
	updateStatus: () => updateStatus(),
	checkForUpdates: () => checkForUpdates(),
	downloadUpdate: vi.fn(),
	installUpdate: vi.fn()
}));

const UpdateCard = (await import('./UpdateCard.svelte')).default;

function state(overrides: Partial<UpdateState> & Pick<UpdateState, 'phase'>): UpdateState {
	return {
		version: '0.2.0',
		latest: '',
		percent: 0,
		message: '',
		...overrides
	};
}

describe('UpdateCard.svelte', () => {
	afterEach(() => vi.clearAllMocks());

	it('does not sit on "checking" when the launch check lands after it mounts', async () => {
		// The bug this guards: the shell sets `checking` before the window paints,
		// so the card's first read is almost always mid-check. A card that only
		// re-read during a download would show that first answer for good — and
		// the button that would refresh it is disabled for being mid-check.
		updateStatus
			.mockResolvedValueOnce(state({ phase: 'checking', message: 'Checking for updates…' }))
			.mockResolvedValue(
				state({
					phase: 'available',
					latest: '0.3.0',
					message: 'Budgy 0.3.0 is available — you have 0.2.0.'
				})
			);

		const rendered = render(UpdateCard);

		await expect
			.element(rendered.getByText('Budgy 0.3.0 is available — you have 0.2.0.'))
			.toBeInTheDocument();
	});

	it('keeps reading while a download is running', async () => {
		updateStatus
			.mockResolvedValueOnce(
				state({ phase: 'downloading', latest: '0.3.0', percent: 10, message: 'Downloading…' })
			)
			.mockResolvedValue(
				state({
					phase: 'ready',
					latest: '0.3.0',
					message: 'Budgy 0.3.0 is ready, and installs when you quit.'
				})
			);

		const rendered = render(UpdateCard);

		await expect
			.element(rendered.getByRole('button', { name: 'Quit and install' }))
			.toBeInTheDocument();
	});

	it('stops reading once the shell has settled', async () => {
		updateStatus.mockResolvedValue(
			state({ phase: 'current', message: 'Budgy 0.2.0 is the latest version.' })
		);

		const rendered = render(UpdateCard);

		await expect
			.element(rendered.getByText('Budgy 0.2.0 is the latest version.'))
			.toBeInTheDocument();

		const settled = updateStatus.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 1600));

		// A settled phase is an answer; polling on would be asking a question
		// nobody has.
		expect(updateStatus.mock.calls.length).toBe(settled);
	});
});
