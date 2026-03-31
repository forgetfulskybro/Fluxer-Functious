import { readdirSync } from "fs";
import color from "../functions/colorCodes";
export default (client) => {
  const functions = readdirSync(`./functions`).filter(d => d.endsWith('.js'));
  for (let file of functions) {
    let evt = require(`../functions/${file}`);
    client.functions.set(file.split(".")[0], evt);
  };

  console.log(color("%", `%b[Function_Handler]%7 :: Loaded %e${client.functions.size} %7functions`));
}; 