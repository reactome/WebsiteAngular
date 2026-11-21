# Contract: the page's report states, their words and actions

The line beside the Download tab's report button. Words are the first draft for review;
the states and actions are the contract.

| State               | The line says                                                                             | Actions         |
| ------------------- | ----------------------------------------------------------------------------------------- | --------------- |
| idle                | (nothing)                                                                                 | Download report |
| starting            | Starting your report…                                                                     | Cancel          |
| queued              | Queued: number _place_ in line · about _t_ left ("next in line" at 1)                     | Cancel          |
| making, reading     | Making your report: reading the results · about _t_ left                                  | Cancel          |
| making, figures     | Making your report: drawing figures _done_ of _total_ · about _t_ left                    | Cancel          |
| making, printing    | Making your report: printing · about _t_ left                                             | Cancel          |
| past the estimate   | … · taking longer than expected                                                           | Cancel          |
| saved               | Report downloaded                                                                         | Download again  |
| failed, gone        | This analysis's results are no longer available. Run the analysis again to make a report. | (none)          |
| failed, busy        | The report service is busy. Try again in _s_ seconds.                                     | Try again       |
| failed, failed      | The report could not be made. Try again, or tell us (the contact form).                   | Try again       |
| failed, unreachable | No word from the report service for two minutes.                                          | Try again       |

- **_t_** is shown as "under a minute", "about _n_ minutes", from the status's `estimate`;
  absent with no estimate.
- **Accessibility:** the line is a polite live region; Cancel and Try again are buttons;
  the line's words are the buttons' description.
- **Look:** as the tab's other downloads' progress (the managed-download styles), so the
  report reads like the other files.
