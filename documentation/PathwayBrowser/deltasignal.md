# DeltaSignal pathway perturbation prototype

The Pathway Browser's **Perturb** action is a focused end-to-end integration
with the DeltaSignal steady-state solver. It lets a user select an entity on a
Reactome pathway, define one or more perturbations, run the solver, and view the
predicted response on the existing Reactome diagram.

## User flow

1. Open a pathway for which DeltaSignal has a generated network.
2. Select a physical entity on the diagram.
3. Choose **Perturb**.
4. Set activity on the 0–100 DeltaSignal input scale and add the perturbation.
5. Repeat for any additional inputs, then choose **Run DeltaSignal**.
6. Inspect convergence, predicted activities, changes from baseline, influence
   scores, and the diverging diagram overlay.

One Reactome entity can map to several logic-network UUIDs. The same input is
applied to all matching UUIDs. Result rows are aggregated to one row per
Reactome stable identifier for readability, while the diagram preserves all
member values and renders them as a gradient.

## API and scale

The client uses the DeltaSignal API without sharing implementation code:

- `GET /api/pathways`
- `POST /api/parse { pathway_id }`
- `POST /api/solve { network_id, observations }`

Input activity uses the solver's 0–100 UI scale, where `0` is a knockout and
`1` is normal baseline activity. Solver output is returned on a 0–1 internal
scale and is multiplied by 100 before display. Diagram colour represents the
change from each node's own baseline, not its absolute activity.

## Local development

Run the DeltaSignal server on port 8080 with a generated pathway catalog, then
start this workspace with separate Reactome and DeltaSignal backends:

```sh
DS_PATHWAY_CATALOG=/path/to/logic-network-generator/output \
  julia --project=/path/to/deltasignal /path/to/deltasignal/src/api/server.jl \
  --host=127.0.0.1 --port=8080

REACTOME_BACKEND=https://reactome.org \
DELTASIGNAL_BACKEND=http://127.0.0.1:8080 \
npm run start:simple -- --host 127.0.0.1
```

The Angular development proxy sends `/api` to `DELTASIGNAL_BACKEND`. If the
variable is omitted, it defaults to `http://localhost:8080`.

## Deliberate scope

This prototype covers one pathway and steady-state prediction. It does not yet
join several pathways, overlay results on ReacFoam, represent temporal order,
or expose model benchmarking. Those are follow-on features rather than hidden
behaviour in this UI.
