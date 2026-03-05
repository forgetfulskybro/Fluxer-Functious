const color = require("../functions/colorCodes");

module.exports = async (client, error) => {
  console.log(color("%", "%4[Error_Handling] :: Websocket Connection%c"));
  console.log(error);
  process.exit(1);
};
