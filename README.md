# MMM-voetbalnl

MagicMirror² module die uitslagen van jouw voetbal.nl-team(s) toont.

## Installatie

1. Kopieer deze map naar `~/MagicMirror/modules/MMM-voetbalnl`
2. Voer `npm install` uit in de modulemap
3. Voeg het blok hieronder toe aan `config/config.js`

```js
{
  module: "MMM-voetbalnl",
  position: "top_right",
  config: {
    maxMatches: 10,        // standaard: laatste 10 wedstrijden
    updateInterval: 3600000,
    dailyUpdateTime: "13:00", // 1x per dag scores verversen (HH:mm)
    teamName: "Bilt De FC MO15-2",
    teamId: "T707686914",
    email: "jouwemail@voorbeeld.nl",
    password: "jouwwachtwoord"
  }
}
```

Je kunt ook meerdere teams instellen:

```js
config: {
  teams: [
    { name: "Bilt De FC MO15-2", teamId: "T707686914" },
    { name: "Tweede Team", teamId: "T123456789" }
  ],
  maxMatches: 10,
  dailyUpdateTime: "13:00",
  email: "jouwemail@voorbeeld.nl",
  password: "jouwwachtwoord"
}
```

`teamId` is voldoende. De module bouwt zelf de juiste voetbal.nl uitslagen-URL.

Let op: inloggegevens in `config/config.js` zijn leesbaar op het systeem waar MagicMirror draait.

## Lokaal testen

1. Kopieer `local_testing/credentials.example.js` naar `local_testing/credentials.js` en vul je gegevens in
2. Gebruik `teamName` + `teamId` (bijv. `T707686914`), of meerdere teams via `teams`
3. Optioneel: stel `maxMatches` en `dailyUpdateTime` in voor lokaal testgedrag (standaard `10` en `13:00`)
4. Start de testserver: `npm test`
5. Open http://localhost:3456 in je browser

`local_testing/credentials.js` staat in `.gitignore` en wordt nooit meegestuurd naar git.

## API koppelen

De scraper:
- schakelt automatisch naar `data-button-switch="my_team"`
- klikt op `Toon alle uitslagen`
- leest alle seizoenen uit de dropdown (`ScheduleResults-viewSelectTrigger`)

Voor lokaal testen komen inloggegevens en teamconfiguratie uit `local_testing/credentials.js`.
In de MagicMirror-omgeving komen ze uit `config/config.js`.

## Cache en sync

- De module bewaart uitslagen in `cache.json` in de modulemap.
- Bij normale MagicMirror refreshes wordt eerst de lokale cache gebruikt.
- Er wordt pas opnieuw van voetbal.nl opgehaald na de ingestelde dagelijkse sync-tijd.
- Standaard is dat `13:00`; aanpasbaar met `dailyUpdateTime` in `HH:mm` formaat.
- Onderaan de module zie je wanneer voor het laatst succesvol is gesynced.

