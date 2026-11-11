# Alphonse
> Developer: [Brandon Bayquen](https://github.com/bayquen) (a.k.a. big bro)

### Slack assistant that helps onboard your engineers faster.

<p align="center">
   <img width="358" height="358" alt="alphonse-serious-mogging" src="https://github.com/user-attachments/assets/b61b2f96-b7f6-4b29-8b0e-f1b3f1fe20b2" />
</p>

## Main Commands
- **Ask Alphonse (Q&A)**: On a Slack channel where the assistant resides, type `@Alphonse <prompt>` and send.  
- `/add_repo <https://github.com/[user]/[repo-name]>` - Queues and adds your team's GitHub repo to Alphonse's memory (max 1 repo per Slack workspace)  
- `/add_linear_workspace` - Queues and adds your team's Linear workspace Issues to Alphonse's memory (make sure to choose ONLY your team's workspace via your Linear account)  
  
### [*Hi there, reader. You're probably wondering...*]()

## "What in the flop is Alphonse, big bro?" 
<p align="center">
<img width="500" height="210" alt="alphonse-goofy-mogging" src="https://github.com/user-attachments/assets/2065ad62-3f38-41cd-98f4-119c8fd8f0cf" />
</p>

> Great question, you clanker-loving, tech enthusiast *(or AI hater, or skeptic - I won't discriminate)*.  
  
***Alphonse*** is a Q&A Slack assistant that quickly answers technical questions about your team's software product. 
Get up to speed on product features, system architecture, updates, and team product decisions. 
He can read data from both your team's GitHub repo and relevant Linear workspace for comprehensive Q&A queries (technical + business/product-level context).

> And yes, my assistant is inspired by Al Elric from Fullmetal, hence his character :)  

## "How the flip do I use Alphonse?" 😳😖
> *Woah reader, why are you making those faces? Calm down, I'll tell you how:*
  
1. **INSTALL.** Follow this [awesome URL](https://rtfm-web.onrender.com/slack/install) to install Alphonse.  
2. Click the "**Add to Slack**" button. Then on the new Slack auth page, choose your team's Slack workspace in which Alphonse will be installed. (You should be redirected to a "Yippee!" page upon success.)  
3. Open your team's Slack workspace and open a channel where you'd like to ask questions.  
4. Then run this Slack command: `/invite @Alphonse`. You can also click the channel name, open **Integrations**, and add Alphonse from there. Of course, you can have him present in multiple Slack channels.  
### Teach Alphonse about your product's GitHub repo
5. **ADD YOUR REPO.** In any Slack channel where your team invited Alphonse, run the `/add_repo` command followed by your team's repo URL, ***including*** the `https://` prefix! Alphonse will check that he can reach the repository (and that it's a valid URL).  
> **Follow this URL format:** `/add_repo https://github.com/user/your-repo`
  
- If your repo is set to **public**: he'll confirm that it's been queued to be stored in his memory.  
- Otherwise, if it's **private**: a pop-up will appear:
  
   a. Click the access link provided  
  
   b. Approve access for Alphonse on the GitHub page that opens. You can select which repos that Alphonse can reach. Just make sure you have access to view the given repo.  
     
   c. When you see "GitHub app authorized" in a new page, return to Slack and run `/add_repo` again.  
     
6. Wait for Alphonse to finish reading (wait time depends on repo size). A confirmation DM from Alphonse will be sent to you upon success.  
> Note: If you see a "Repo Access Failed" pop-up on Slack, make sure the **GitHub URL** is correct and try again  
  
### Connect your Linear workspace
> (**Recommended** for comprehensive Q&A, but optional)  
7. **ADD YOUR LINEAR TEAM.** Run the Slack command: `/add_linear_workspace`  
8. Click the access link provided in the Connect Linear pop-up and follow the steps in the Linear redirect page.
- ⚠️ **IMPORTANT:** Alphonse v1.0 has a bug where he forgets to delete previously ingested Linear data, so make sure you pick the correct ***Linear*** team/workspace associated with your ***GitHub*** repo!  
9. Approve access for your desired Linear workspace/team. When you see "Linear connected!", return to Slack. Alphonse can now read your team's Linear issues.
> Now you can ask Alphonse anything regarding your product's code AND your team's product decisions! Just @Alphonse <prompt>  
  
## Usage Tips
### Example questions to ask Alphonse:  
- "Help me get familiar with our product without the advanced technical jargon."  
> e.g. Alphonse could answer by gathering your team's repo file docs!
  
- "How does (feature X) work on the backend? Explain the flow step by step."  
> e.g. via repo + Linear
  
- "Which blockers do you recommend we prioritize now?"  
> e.g. Alphonse could answer by gathering your team's repo file docs and/or Linear Issues!  

### Tips to maximize Alphonse's usefulness

1) ⚠️**MOST IMPORTANT:** Keep your product's documentation up to date!! Alphonse works best when your repo docs and Linear issues are comprehensive and well-written. Alphonse provides better answers the more thorough and clear all your documentation is.

2) If Alphonse says he doesn't know, the information probably isn't in your connected repos or Linear workspace. He won't make up an answer.  

3) Just like with any other LLM interface, be as specific as needed. "How does enterprise login work in the OAuth service?" is more specific than "How does our login work?"  

## Tech Stack:
**Frontend:** Slack's already-existing UI *(yay!)*  
**Backend:** Node.js, TypeScript, Express, Slack Bolt JS  
**Databases:** Supabase (PostgreSQL + pgvector), Redis Cloud (Redis CLI)  
**Auth:** GitHub OAuth, Linear OAuth, Slack OAuth  
**AI:** OpenAI `gpt-6.1-sol` and/or `gpt-6.1-terra`  
**Embeddings (RAG):** VoyageAI `voyage-code-3`  
**Backend deploy:** Render (with WebSocket enabled)  
