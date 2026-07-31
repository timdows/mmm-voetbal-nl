// Voetbal.nl account credentials
// Kopieer dit bestand naar credentials.js en vul je gegevens in
// credentials.js wordt NIET meegestuurd naar git

module.exports = {
  email: "jouwemail@voorbeeld.nl",
  password: "jouwwachtwoord",
  // Optioneel: maximaal aantal recente wedstrijden in local test-output
  maxMatches: 10,
  // Optioneel: dagelijkse sync-grens (HH:mm), standaard 13:00
  dailyUpdateTime: "13:00",
  // Optie 1: een enkel team
  teamName: "Bilt De FC MO15-2",
  teamId: "T707686914",

  // Optie 2: meerdere teams (optioneel, overschrijft teamName/teamId)
  teams: [
    {
      name: "Bilt De FC MO15-2",
      teamId: "T707686914",
    },
  ],
};
