import { registerRoot, Composition } from "remotion";
import { WebStory } from "./web-story";
import { webSchema, type WebProps } from "./web-schema";
import input from "../inputs.json";
const props = webSchema.parse(input.props);
const Root = () => (
  <Composition
    id="WebStory"
    component={WebStory}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={600}
    schema={webSchema}
    defaultProps={props}
    calculateMetadata={({ props }: { props: WebProps }) => ({
      durationInFrames: props.shots.reduce(
        (n, s) => n + Math.round(s.seconds * 30),
        0,
      ),
    })}
  />
);
registerRoot(Root);
