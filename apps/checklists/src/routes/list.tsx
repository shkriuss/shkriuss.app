import { createRoute } from "@tanstack/react-router";
import { OneList } from "../features/lists/OneList.tsx";
import { readList } from "../features/lists/lists.ts";
import { rootRoute } from "./root.tsx";

/** A list's screen, at `/lists/<id>`, where each list on the first screen leads. */
export const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lists/$listId",
  // The list is read before its screen shows, so that the screen's heading, which takes the
  // focus, has the list's name from the start. The screen then follows the list.
  loader: async ({ context: { db }, params: { listId } }) => readList(db, listId),
  // Read again at each visit, rather than shown from the last one first.
  gcTime: 0,
  component: ListScreen,
});

function ListScreen() {
  const { db } = listRoute.useRouteContext();
  const { listId } = listRoute.useParams();
  const loaded = listRoute.useLoaderData();
  return <OneList key={listId} db={db} listId={listId} loaded={loaded} />;
}
