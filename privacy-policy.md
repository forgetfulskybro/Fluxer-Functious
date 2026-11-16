# Privacy Policy

**Last Updated:** November 15, 2026

This Privacy Policy describes how the Fluxer bot (referred to as **Functious**) and its dashboard collect, use, store, and delete data.
Functious operates exclusively on the Fluxer platform. This policy applies **only** to data handled by Functious. Fluxer itself has its own separate privacy policy.

By using Functious, you agree to the practices outlined below.

---

## 1. Data We Collect

We collect the data needed to operate the features you use. This is feature-specific data, not a general archive of your messages. We do not keep a general message history or store the arguments you type after a command.

We do not intentionally store email addresses, IP addresses, passwords, payment information, or advertising identifiers in the bot database. We do not use advertising trackers or tracking pixels.

- **Account and preferences:** Fluxer user ID, timezone, birthday day and month, optional age, birthday announcement preference, communities where birthday announcements are enabled or disabled, community birthday blacklists, translation roles, credited languages, and requested languages.
- **Reminders and watched messages:** Reminder text, delivery time, type, creation time, and channel or source message IDs. Reaction reminders also store community and channel IDs and names, source message and author IDs, a short sample and normalized fingerprint of the watched message, attachment filenames, reminder message, duration, language, and match count.
- **Community configuration and roles:** Community IDs and settings; tag, sticky, and scheduled-message content or embed data; creator IDs; temporary-channel owner and channel IDs; timezone entries; birthday opt-outs; and sticky-role or timed-role assignments.
- **Polls:** Owner, question and options, voter user IDs, public avatar URLs, vote choices, and counts.
- **Giveaways:** Owner, prize and requirements, entrant user IDs, winners, and related configuration.
- **Events:** Host ID, title, description, location, times, reminder text, and RSVP responses.
- **Forms:** Creator ID, questions, applicant and reviewer IDs, submitted answers, review status, and review reason.
- **Translations:** Translation text, previous values, notes, status, timestamps, and the user ID credited for an edit.
- **Audit and command-usage events:** We send events to our Vanta service containing user ID, username and discriminator, community ID, command name, and community setting changes with previous and new values. Some values can contain content you configured, such as a tag description or reminder text. Command arguments are not sent.
- **Website session:** One essential HTTP-only cookie named `functious_session` containing your Fluxer profile and the access token needed to view your communities. It expires after 7 days and is removed when you log out.

## 2. How We Use the Data

- To run reminders, polls, giveaways, events, forms, tags, stickies, scheduling, translations, birthdays, and temporary channels.
- To remember preferences and apply community-specific settings and role assignments.
- To let authorized community managers review form submissions and configuration changes.
- To maintain audit logs, understand which commands are used, troubleshoot errors, prevent abuse, and improve Functious.
- To authenticate you to the dashboard and show the data associated with your account.

We do not sell your data, use it for advertising, or build advertising profiles from it.

## 3. Data Retention & Deletion

Retention depends on the feature. Some data is removed automatically, but not every record is deleted as soon as the related poll, giveaway, or event ends.

- **Reminders** are removed after the delivery attempt.
- **Reaction reminders** remain until you remove them, their channel or community disappears, or your data is deleted.
- **Polls and giveaways** are kept after they end, including voter or entrant IDs and winner records, until the record or your related data is deleted. Ending a poll or giveaway does not by itself purge those records.
- **Events and forms** remain until the event, form, or submission is deleted or withdrawn. An event ending does not delete its record or RSVPs.
- **Translation text** remains part of the bot's localization. Deleting your data removes your attribution and notes, but not the translated text.
- **Community data** is kept while Functious remains in the community and is cleaned up by scheduled maintenance after the bot is removed.
- **Temporary-channel records** are removed when the temporary channel is cleaned up.
- **Account records** such as user ID, timezone, birthday, reminders, and reaction reminders remain until you use delete everything or ask us to remove them.
- **Vanta audit and usage events** are retained by the Vanta service. The dashboard displays the last 90 days. They are not removed by the bot's self-service deletion; contact us to request their removal.
- **Website session cookie** expires after 7 days or when you log out.
- **Privacy data cache** may keep a copy of your data in bot memory for up to 20 minutes.

## 4. Your Choices & Right to Delete

Signed-in users can open **Profile → Data & privacy** to view and download the data connected to their user ID in the bot database and queues.

- **Selective deletion** can remove individual polls, giveaways, events, RSVPs, forms, form submissions, translation credits and notes, and community references. Removing a record you own can also remove other users' participation in it.
- **Delete everything** requires an explicit acknowledgement. It removes your user record, reminders, reaction reminders, birthday and timezone data, votes and giveaway entries, polls and giveaways you own, events you host, RSVPs, forms and submissions you own, your form reviewer ID, and your translation credits, notes, and community references.
- **Delete everything does not remove:** translated text published in the bot's localization, most messages already sent to Fluxer (feature messages may be removed with their records), Vanta audit or command-usage events, or the browser session cookie. Log out to clear the cookie.
- **Account-level records** that are not offered as individual checkboxes, such as reminders and birthday details, can be removed with delete everything.

Because Vanta events are held outside the bot database, self-service deletion does not erase them. Contact the developer through the official support community to request removal of audit or command-usage events.

## 5. Data Storage & Security

The bot database is hosted on the developer's home-lab hardware. Website sessions use a signed, HTTP-only cookie rather than a server-side session database. Vanta and Fluxer are external services, as described below. We use access controls and other standard safeguards, but no system is completely secure.

## 6. Children's Privacy

Functious is not directed at children under 13. If you are under 13, please do not use Functious. We do not knowingly collect data from children under 13.

## 7. Third-Party Services

We do not sell or rent data. We use service providers only to operate Functious:

- **Fluxer** provides authentication, profiles, communities, messages, and voice features through its API. Fluxer handles that data under its own privacy policy.
- **Vanta** receives the audit and command-usage events described above, including user and community identifiers, username and discriminator, command names, and configuration values. It powers the dashboard audit log and usage analytics. Vanta events are not covered by the bot's self-service deletion.
- **Sentry** may receive error diagnostics when error monitoring is enabled. We do not intentionally attach message content to those reports.

We do not allow these providers to use your data for their own advertising or sell it.

## 8. Changes to This Policy

We may update this Privacy Policy occasionally. The "Last Updated" date at the top will reflect changes, and major updates will be announced in Functious' official support community.

## 9. Questions or Concerns

Contact the developer through the official support community (link available in Functious' bio or the `f!info` command). It can also be found under the **Support** dropdown.

---

By using Functious, you acknowledge that you have read and understood this Privacy Policy.
