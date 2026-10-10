import { Frame, ScreenLink, SOURCE_URL } from "@shkriuss/shell/site";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { m } from "../messages.ts";

/** The root of every page: the shell's frame, with the hub's pages, its source and its licenses. */
export const rootRoute = createRootRoute({ component: Root });

function Root() {
  return (
    <Frame
      name={m.title()}
      navigation={
        <>
          <ScreenLink to="/install">{m.install()}</ScreenLink>
          <ScreenLink to="/privacy">{m.privacy()}</ScreenLink>
          <ScreenLink to="/security">{m.security()}</ScreenLink>
        </>
      }
      footer={
        <div className="flex flex-col gap-1">
          <p>{m.freeSoftware()}</p>
          <p className="flex flex-wrap gap-x-4">
            <a href={SOURCE_URL}>{m.sourceCode()}</a>
            <ScreenLink to="/licenses">{m.licenses()}</ScreenLink>
          </p>
        </div>
      }
    >
      <Outlet />
    </Frame>
  );
}
