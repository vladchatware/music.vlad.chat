import { speech } from "../public/ai";

const args = process.argv

if (args.length < 3) {
  console.log('Please provide a text argument.')
} else {
  const inputText = args[2]
  
  const file = await speech(inputText)

  await Bun.write(Bun.stdout, file)
}
 
