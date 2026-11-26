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
| `auto_close` | Seconds without a touch, click, scroll or key before the pop-up closes itself. Default 30; `0` never. It never closes while a camera row is open. |
| `link` | Optional header button that closes the pop-up and goes to a dashboard path: `{ path: /dashboard/view, label: Show all }`. `label` defaults to "Show all". |
| `secondary` | How the line under each name is built from the item's fields: a list of parts joined with " · ". A part is a field name, or `{ field, unit?, prefix?, text?, map?, duration?, round?, names? }`: `text` is shown when the field is true, `names: true` shows entity ids as HA's own entity names, `map` translates values, `duration: true` shows seconds as "14m", `round` sets decimal places, otherwise prefix + value + unit. List values are joined with ", ". |
| `groups` | Optional sections, in order: `[{ value, title, colour }]`. Items whose `group` field (or `group_field`) equals `value` are listed under a `title` heading in `colour`, with their icons tinted to match. Items in no listed group come last. |
| `actions` | Button look per service: `{ "cover.close_cover": { label: "Close {name}", icon, colour, busy_label: "Closing…" } }`. `{name}` is the row's name. `disabled: true` shows the button greyed out (e.g. a "Stopping…" state). `cycle: [{ label, icon?, colour? }, …]` keeps the button live and steps its look with each press (e.g. Stop → Resume), for actions where every press does the same thing; `disabled_by: { field, labels }` greys the button out while that item field is set, labelled by its value (e.g. `{ field: moving, labels: { opening: "Opening…" } }`). |
| `camera_card` | Card config used for each camera of an expanded row, so the feeds look like your dashboard's own camera cards. Every `$camera`, `$title` and `$page` string in it is replaced with the camera entity, its title and its page from `camera_pages`. Without it, a plain HA camera image is shown. |
| `camera_pages` | Each camera's own dashboard page, e.g. `{ camera.front_gate: /home-panel/sub-front-gate }`, used as `$page` (a tap action `navigate` to `$page` opens it). Any navigation closes the pop-up. |

```yaml
camera_card:
  type: custom:advanced-camera-card
  cameras:
    - camera_entity: $camera
      title: $title
  view:
    default: live
```

### Hanging from what opened it

If the tapped element (or one around it) has a `data-popup-anchor` attribute (its value names the anchor, so the
pop-up finds it again after its card redraws),
the pop-up hangs just below it, its left edge on the anchor's left edge (or as far right as
fits inside the card the anchor is in, else on screen, and above it if there's more room there), and the anchor stays lit
through the dimmed backdrop. Status Strip Card pills are anchors. Without one,
the pop-up is centred.

The list follows the helper while the pop-up is open. Escape, the close
button or a tap outside closes it.

## The list

The attribute is a list (or a JSON string of one) of:

| Key | Meaning |
| --- | --- |
| `name` | Row title. Falls back to `entity_id`'s friendly name. |
| any other field | Plain facts (`area`, `level`, `low`, …) that the pop-up's `secondary` setting turns into the line under the name. |
| `secondary` | A ready-made line, used only when the pop-up has no `secondary` setting. |
| `icon` | Optional icon override. By default the row shows HA's own icon for `icon_entity` (else `entity_id`), exactly as a tile would. |
| `icon_entity` | Optional entity whose HA icon the row shows (e.g. a gate's cover rather than its position sensor). |
| `since` | A timestamp shown as "since 11:00 pm" (today) or "since 25 Nov". Falls back to when `entity_id` last changed; `null` shows no time. |
| `entity_id` | Optional; used for the fallbacks above and as the default action target. |
| `action` | Optional row button: `{ service: domain.service, target?, data?, style? }`, i.e. what to do; `style` picks which `actions` entry it looks like (default: the service). How it looks comes from the pop-up's `actions` setting. Tapping calls the service, then the button shows its busy label, disabled. It comes back after a minute if the row is still listed; normally the helper drops the row once the action has worked. |
| `camera` / `cameras` | Optional camera entity, or a list of entities or `{ entity, title }`. The row then shows a chevron that expands the feeds (one `camera_card` each, two side by side) with the `action` button under them, so you look before acting. Only one row is expanded at a time. |
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
            {{ [{'name': 'Printer', 'area': 'Workshop', 'sensors': ['Door'],
                 'entity_id': 'binary_sensor.printer_door'}] }}
        state: "{{ devices | count }}"
        attributes:
          devices: "{{ devices }}"
```

with `secondary: [area, sensors]` in the pop-up config, the row reads
"Printer" over "Workshop · Door", with the door sensor's own HA icon.

## Styling

The pop-up uses `--ha-dialog-surface-background`, so it matches HA's own
dialogs. Override it with `--list-popup-background`, `--list-popup-border`,
`--list-popup-shadow` and `--list-popup-backdrop` (no blur by default: it's hard on tablet GPUs).
A pop-up opened from an anchor takes these, and the theme colours it draws
with, from where it was opened, so a view's own theme reaches it.
