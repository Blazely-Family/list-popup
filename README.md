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
| `noun` | Adds a count to the header, e.g. `device` gives "1 device", "3 devices". Without it the header shows the bare count. |
| `since` | `false` hides the time column. |
| `empty` | Text when the list is empty. Default "Nothing to show". |

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
| `entity_id` | Optional; used only for the fallbacks above. |

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
