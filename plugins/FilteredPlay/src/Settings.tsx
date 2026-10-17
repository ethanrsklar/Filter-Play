import { ReactiveStore } from "@luna/core";
import { LunaSettings, LunaSwitchSetting } from "@luna/ui";

import React from "react";

export const settings = await ReactiveStore.getPluginStorage("FilteredPlay", {
	enabled: true,
	applyToPlayButtons: true,
	showNotice: true,
	debug: false,
});

export const Settings = () => {
	const [enabled, setEnabled] = React.useState(settings.enabled);
	const [applyToPlayButtons, setApplyToPlayButtons] = React.useState(settings.applyToPlayButtons);
	const [showNotice, setShowNotice] = React.useState(settings.showNotice);
	const [debug, setDebug] = React.useState(settings.debug);
	return (
		<LunaSettings>
			<LunaSwitchSetting
				title="Play only filtered tracks"
				desc="When a playlist or Liked tracks has text in its filter box, playing a track queues only the matching tracks"
				checked={enabled}
				onChange={(_: unknown, checked: boolean) => setEnabled((settings.enabled = checked))}
			/>
			<LunaSwitchSetting
				title="Apply to Play and Shuffle buttons"
				desc="The Play and Shuffle buttons at the top of a filtered list also queue only the matching tracks"
				checked={applyToPlayButtons}
				onChange={(_: unknown, checked: boolean) => setApplyToPlayButtons((settings.applyToPlayButtons = checked))}
			/>
			<LunaSwitchSetting
				title="Show notice"
				desc='Show a short "Playing N filtered tracks" message when the plugin takes over the queue'
				checked={showNotice}
				onChange={(_: unknown, checked: boolean) => setShowNotice((settings.showNotice = checked))}
			/>
			<LunaSwitchSetting
				title="Debug logging"
				desc="Log what the plugin detects to the console (Ctrl+Shift+I). Turn on when reporting a bug"
				checked={debug}
				onChange={(_: unknown, checked: boolean) => setDebug((settings.debug = checked))}
			/>
		</LunaSettings>
	);
};
