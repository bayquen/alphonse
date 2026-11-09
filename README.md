# Alphonse
> Developer: Brandon Bayquen

Slack assistant that helps onboard your engineers faster.
<p align="center">
<img width="358" height="358" alt="alphonse-serious-mogging" src="https://github.com/user-attachments/assets/b61b2f96-b7f6-4b29-8b0e-f1b3f1fe20b2" />
</p>

Alphonse is a Q&A Slack assistant that quickly answers questions about your team's software product. Help your engineers get up to speed on product features, architecture, updates, and team decisions. Alphonse can read data from both your team's GitHub repo and Linear workspace for comprehensive Q&A queries.

## How to Use
1. Open your team's Slack workspace and choose the channel where you'd like to ask questions. 
2. Then run this Slack command: `/invite @Alphonse`. You can also click the channel name, open **Integrations**, and add Alphonse from there. Of course, you can have him present in multiple Slack channels.
3. In any channel where Alphonse resides, run the `/add_repo` command followed by your repository's link (including the *https://* prefix). For example: `/add_repo https://github.com/user/your-repo`
4. Alphonse will check that he can reach the repository (and that it's a valid URL).
5. If your repo is public: he'll confirm that it's been queued to be stored in his memory.
6. If your repo is private: a pop-up modal will appear.  
   - Click the link provided
   - Approve access for Alphonse on the GitHub page that opens. You can select which repos that Alphonse can reach. Just make sure you have access to view the given repo.
   - When you see "GitHub app authorized" in a new page, return to Slack and run `add_repo` again.
7. Wait for Alphonse to finish reading. Wait time depends on repo size.
> Note: If you see a "Repo Access Failed" pop-up on Slack, check that the link is correct and try again

**Connect your Linear workspace** (optional, but recommended)  
8. Run the Slack command: `/add_linear_workspace`  
9. Click the access link provided in the Connect Linear pop-up  
10. Approve access on the Linear page that opens. When you see "Linear connected!", return to Slack. Alphonse can now read your team's Linear issues.  
