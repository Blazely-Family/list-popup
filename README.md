# List Popup

A list pop-up for Home Assistant dashboards. Any card opens it with HA's
standard `fire-dom-event` tap action: no Browser Mod, no extra card.

It holds no logic of its own. It draws a list that a Home Assistant helper
provides as an entity attribute, one row per item, in the theme's dialog
colours. Rows are display only.

Install it as a custom repository in HACS or the Marketplace (category
Dashboard). It registers itself as a dashboard resource.

## Opening it

```yaml
tap_action:
  action: fire-dom-event
  list_popup:
    entity: sensor.example_offline_devices
    attribute: devices
    title: Offline
    icon: mdi:access-point-network-off
    colour: yellow
    noun: device
```

| Key | Meaning |
| --- | --- |
| `entity` | The helper entity holding the list. Required. |
| `attribute` | The attribute holding the list. Default `items`. |
| `title`, `icon` | Header text and icon. |
| `colour` | Header chip and row icon colour: `yellow`, `green`, `blue`, `red`, `grey`, `quiet` (default), or any CSS colour. |
| `icon_colour` | Colour of the header icon (on its `colour` chip) and of the row icons, e.g. an orange icon on a quiet chip, as on a status strip pill. |
| `noun` | Adds a count to the header, e.g. `device` gives "1 device", "3 devices". Without it the header shows the bare count. |
| `since` | `false` hides the time column. |
| `empty` | Text when the list is empty. Default "Nothing to show". |
| `link` | Optional header button that closes the pop-up and goes to a dashboard path: `{ path: /dashboard/view, label: Show all }`. `label` defaults to "Show all". |

The list follows the helper while the pop-up is open. Escape, the close
button or a tap outside closes it.

## The list

The attribute is a list (or a JSON string of one) of:

| Key | Meaning |
| --- | --- |
| `name` | Row title. Falls back to `entity_id`'s friendly name. |
| `secondary` | The line under the name. |
| `icon` | Row icon. Falls back to `entity_id`'s icon, then the header icon. |
| `since` | A timestamp shown as "since 11:00 pm" (today) or "since 25 Nov". Falls back to when `entity_id` last changed. |
| `entity_id` | Optional; used for the fallbacks above and as the default action target. |
| `action` | Optional row button: `{ label, icon?, action: domain.service, target?, data?, colour?, busy_label? }`. Tapping calls the service (target defaults to `entity_id`), then the button shows `busy_label` (default "Sent…") disabled. It comes back after a minute if the row is still listed; normally the helper drops the row once the action has worked. |
| `camera` / `cameras` | Optional camera entity, or a list of them. The row then shows **View**, which expands the live feeds (HA's MJPEG camera proxy; two side by side) with the `action` button under them, so you look before acting. Only one row is expanded at a time. |
| `key` | Optional stable id for the row (default `entity_id`, then `name`). |

When the last row disappears while the pop-up is open (for example the gate
it was showing has shut), the pop-up closes itself straight away. Set
`close_when_empty: false` in the pop-up config to keep it open.

A template sensor can build it, for example:

```yaml
template:
  - sensor:
      - name: Example offline devices
        variables:
          devices: >-
            {{ [{'name': 'Printer', 'secondary': 'Workshop · Door',
                 'icon': 'mdi:printer-3d', 'since': now().isoformat()}] }}
        state: "{{ devices | count }}"
        attributes:
          devices: "{{ devices }}"
```

## Styling

The pop-up uses `--ha-dialog-surface-background`, so it matches HA's own
dialogs. Override it with `--list-popup-background`, `--list-popup-border`
and `--list-popup-backdrop`.
