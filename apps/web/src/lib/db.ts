import { doc, getDoc, setDoc, getDocs, collection, query, where, onSnapshot, deleteDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

// --- Flat Collection Paths ---
// We use a deterministic ID pattern for 1-to-1 relationships to avoid needing complex queries.

const getWorkflowId = (userId: string, workflowId: string) => `${userId}_${workflowId}`;
const getIntegrationId = (userId: string, integrationId: string) => `${userId}_${integrationId}`;
const getCloudCredentialId = (userId: string, providerId: string) => `${userId}_${providerId}`;
const getEnvironmentId = (userId: string, envId: string) => `${userId}_${envId}`;
const getProjectId = (userId: string, projectId: string) => `${userId}_${projectId}`;

async function getAuthenticatedUser() {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return await new Promise<typeof auth.currentUser>((resolve) => {
    const unsubscribe = auth.onAuthStateChanged((user: any) => {
      unsubscribe();
      resolve(user);
    });
  });
}

async function getApiHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const user = await getAuthenticatedUser();
  const token = user ? await user.getIdToken() : "";
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function refreshGithubTokenIfNeeded(userId: string, integrationData: any) {
  if (!integrationData || !integrationData.accessToken || !integrationData.refreshToken || !integrationData.expiresAt) {
    return integrationData;
  }

  // Check if expired (or within 5 minutes of expiring)
  if (Date.now() + 5 * 60 * 1000 > integrationData.expiresAt) {
    try {
      console.log("GitHub token is expired or expiring soon, refreshing...");
      const res = await fetch("/api/github/refresh", {
        method: "POST",
        headers: await getApiHeaders(),
        body: JSON.stringify({
          refresh_token: integrationData.refreshToken,
          client_id: integrationData.clientId,
          client_secret: integrationData.clientSecret
        })
      });
      
      const tokenData = await res.json();
      
      if (tokenData.access_token) {
        integrationData.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) {
           integrationData.refreshToken = tokenData.refresh_token;
        }
        if (tokenData.expires_in) {
           integrationData.expiresAt = Date.now() + tokenData.expires_in * 1000;
        }
        if (tokenData.refresh_token_expires_in) {
           integrationData.refreshTokenExpiresAt = Date.now() + tokenData.refresh_token_expires_in * 1000;
        }
        integrationData.updatedAt = new Date().toISOString();
        
        // Save back to Firestore
        await setDoc(doc(db, "integrations", getIntegrationId(userId, "github")), {
           ...integrationData
        }, { merge: true });
        console.log("GitHub token refreshed successfully.");
      } else {
        console.error("Failed to refresh GitHub token, no access_token returned:", tokenData);
      }
    } catch (e) {
      console.error("Failed to refresh GitHub token:", e);
    }
  }
  return integrationData;
}

async function refreshJiraTokenIfNeeded(userId: string, integrationData: any) {
  if (!integrationData || !integrationData.accessToken || !integrationData.refreshToken || !integrationData.expiresAt) {
    return integrationData;
  }

  // Check if expired (or within 5 minutes of expiring)
  if (Date.now() + 5 * 60 * 1000 > integrationData.expiresAt) {
    try {
      console.log("Jira token is expired or expiring soon, refreshing...");
      const res = await fetch("/api/jira/refresh", {
        method: "POST",
        headers: await getApiHeaders(),
        body: JSON.stringify({
          refresh_token: integrationData.refreshToken,
          client_id: integrationData.clientId,
          client_secret: integrationData.clientSecret
        })
      });
      
      const tokenData = await res.json();
      
      if (tokenData.access_token) {
        integrationData.accessToken = tokenData.access_token;
        if (tokenData.refresh_token) {
           integrationData.refreshToken = tokenData.refresh_token;
        }
        if (tokenData.expires_in) {
           integrationData.expiresAt = Date.now() + tokenData.expires_in * 1000;
        }
        integrationData.updatedAt = new Date().toISOString();
        
        // Save back to Firestore
        await setDoc(doc(db, "integrations", getIntegrationId(userId, "jira")), {
           ...integrationData
        }, { merge: true });
        console.log("Jira token refreshed successfully.");
      } else {
        console.error("Failed to refresh Jira token, no access_token returned:", tokenData);
      }
    } catch (e) {
      console.error("Failed to refresh Jira token:", e);
    }
  }
  return integrationData;
}

async function refreshGcpTokenIfNeeded(userId: string, credentialData: any) {
  if (!credentialData || !credentialData.accessToken || !credentialData.refreshToken) {
    return credentialData;
  }

  const isExpired = !credentialData.expiresAt || (Date.now() + 5 * 60 * 1000 > credentialData.expiresAt);
  if (!isExpired) {
    return credentialData;
  }
    try {
      console.log("GCP token is expired or expiring soon, refreshing...");
      const res = await fetch("/api/gcp/refresh", {
        method: "POST",
        headers: await getApiHeaders(),
        body: JSON.stringify({
          refresh_token: credentialData.refreshToken,
          client_id: credentialData.clientId,
          client_secret: credentialData.clientSecret
        })
      });

      const tokenData = await res.json();

      if (tokenData.access_token) {
        credentialData.accessToken = tokenData.access_token;
        if (tokenData.expires_in) {
          credentialData.expiresAt = Date.now() + tokenData.expires_in * 1000;
        }
        credentialData.updatedAt = new Date().toISOString();

        await setDoc(doc(db, "cloud_credentials", getCloudCredentialId(userId, "gcp")), {
          ...credentialData
        }, { merge: true });
        console.log("GCP token refreshed successfully.");
      } else {
        console.error("Failed to refresh GCP token, no access_token returned:", tokenData);
      }
    } catch (e) {
      console.error("Failed to refresh GCP token:", e);
    }
  return credentialData;
}

export const DbAPI = {
  // --- Projects ---
  async getProject(userId: string, projectId: string) {
    const id = getProjectId(userId, projectId);
    const snap = await getDoc(doc(db, "projects", id));
    return snap.exists() ? snap.data() : null;
  },

  async getProjects(userId: string) {
    const q = query(collection(db, "projects"), where("userId", "==", userId));
    const snapshot = await getDocs(q);
    const results: any[] = [];
    snapshot.forEach(doc => {
      const originalId = doc.id.replace(`${userId}_`, "");
      results.push({ ...doc.data(), id: originalId });
    });
    return results;
  },

  async createProject(userId: string, data: any) {
    const projectId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const id = getProjectId(userId, projectId);
    await setDoc(doc(db, "projects", id), {
      ...data,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return projectId;
  },

  async saveProject(userId: string, projectId: string, data: any) {
    const id = getProjectId(userId, projectId);
    await setDoc(doc(db, "projects", id), {
      ...data,
      userId,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  },

  async deleteProject(userId: string, projectId: string) {
    const id = getProjectId(userId, projectId);
    await deleteDoc(doc(db, "projects", id));
  },

  // --- Workflows ---
  async getWorkflow(userId: string, workflowId: string = "current") {
    const id = getWorkflowId(userId, workflowId);
    const snap = await getDoc(doc(db, "workflows", id));
    return snap.exists() ? snap.data() : null;
  },

  async getWorkflows(userId: string) {
    const q = query(collection(db, "workflows"), where("userId", "==", userId));
    const snapshot = await getDocs(q);
    const results: any[] = [];
    snapshot.forEach(doc => {
      const originalId = doc.id.replace(`${userId}_`, "");
      results.push({ ...doc.data(), id: originalId });
    });
    return results;
  },

  async getWorkflowsByProject(userId: string, projectId: string) {
    const q = query(collection(db, "workflows"), where("userId", "==", userId), where("projectId", "==", projectId));
    const snapshot = await getDocs(q);
    const results: any[] = [];
    snapshot.forEach(doc => {
      const originalId = doc.id.replace(`${userId}_`, "");
      results.push({ ...doc.data(), id: originalId });
    });
    return results;
  },

  async saveWorkflow(userId: string, workflowId: string = "current", data: any) {
    const id = getWorkflowId(userId, workflowId);
    await setDoc(doc(db, "workflows", id), {
      ...data,
      userId, // Store userId for potential future relational querying
      updatedAt: new Date().toISOString()
    }, { merge: true }); // Use merge to avoid overwriting missing fields like createdAt
  },

  async createWorkflow(userId: string, data: any) {
    const workflowId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const id = getWorkflowId(userId, workflowId);
    await setDoc(doc(db, "workflows", id), {
      ...data,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return workflowId;
  },

  async deleteWorkflow(userId: string, workflowId: string) {
    const id = getWorkflowId(userId, workflowId);
    await deleteDoc(doc(db, "workflows", id));
  },

  // --- Integrations ---
  async getIntegration(userId: string, integrationId: string) {
    const id = getIntegrationId(userId, integrationId);
    const snap = await getDoc(doc(db, "integrations", id));
    let data = snap.exists() ? snap.data() : null;
    
    if (integrationId === "github" && data) {
      data = await refreshGithubTokenIfNeeded(userId, data);
    }
    
    if (integrationId === "jira" && data) {
      data = await refreshJiraTokenIfNeeded(userId, data);
    }
    
    return data;
  },

  async saveIntegration(userId: string, integrationId: string, data: any) {
    const id = getIntegrationId(userId, integrationId);
    await setDoc(doc(db, "integrations", id), {
      ...data,
      userId,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  },

  async getAllIntegrations(userId: string) {
    const q = query(collection(db, "integrations"), where("userId", "==", userId));
    const snapshot = await getDocs(q);
    const results: Record<string, any> = {};
    snapshot.forEach(doc => {
      // Reconstruct original integrationId from document ID
      const originalId = doc.id.replace(`${userId}_`, "");
      results[originalId] = doc.data();
    });

    if (results["github"]) {
      results["github"] = await refreshGithubTokenIfNeeded(userId, results["github"]);
    }
    
    if (results["jira"]) {
      results["jira"] = await refreshJiraTokenIfNeeded(userId, results["jira"]);
    }

    return results;
  },

  subscribeToIntegration(userId: string, integrationId: string, callback: (exists: boolean, data?: any) => void) {
    const id = getIntegrationId(userId, integrationId);
    return onSnapshot(doc(db, "integrations", id), async (snapshot) => {
      let data = snapshot.data();
      if (snapshot.exists() && integrationId === "github" && data) {
        data = await refreshGithubTokenIfNeeded(userId, data);
      }
      if (snapshot.exists() && integrationId === "jira" && data) {
        data = await refreshJiraTokenIfNeeded(userId, data);
      }
      callback(snapshot.exists(), data);
    });
  },

  async deleteIntegration(userId: string, integrationId: string) {
    const id = getIntegrationId(userId, integrationId);
    await deleteDoc(doc(db, "integrations", id));
  },

  // --- Cloud Credentials ---
  async getCloudCredential(userId: string, providerId: string) {
    const id = getCloudCredentialId(userId, providerId);
    const snap = await getDoc(doc(db, "cloud_credentials", id));
    let data = snap.exists() ? snap.data() : null;

    if (providerId === "gcp" && data) {
      data = await refreshGcpTokenIfNeeded(userId, data);
    }

    return data;
  },

  async saveCloudCredential(userId: string, providerId: string, data: any) {
    const id = getCloudCredentialId(userId, providerId);
    await setDoc(doc(db, "cloud_credentials", id), {
      ...data,
      userId,
      updatedAt: new Date().toISOString()
    }, { merge: true }); // Adding merge: true to support partial updates like in OnboardingModal
  },

  subscribeToCloudCredential(userId: string, providerId: string, callback: (exists: boolean, data?: any) => void) {
    const id = getCloudCredentialId(userId, providerId);
    return onSnapshot(doc(db, "cloud_credentials", id), (snapshot) => {
      callback(snapshot.exists(), snapshot.data());
    });
  },

  async deleteCloudCredential(userId: string, providerId: string) {
    const id = getCloudCredentialId(userId, providerId);
    // Assuming deleteDoc is imported in db.ts
    await import("firebase/firestore").then(({ deleteDoc }) => 
      deleteDoc(doc(db, "cloud_credentials", id))
    );
  },

  // --- Secrets ---
  async saveSecret(userId: string, secretKey: string, data: any) {
    const id = `${userId}_${secretKey}`;
    await setDoc(doc(db, "secrets", id), {
      ...data,
      userId,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  },

  // --- Environments ---
  async getEnvironments(userId: string) {
    const q = query(collection(db, "environments"), where("userId", "==", userId));
    const snapshot = await getDocs(q);
    const results: any[] = [];
    snapshot.forEach(doc => {
      const originalId = doc.id.replace(`${userId}_`, "");
      results.push({ ...doc.data(), id: originalId });
    });
    return results;
  },

  async saveEnvironment(userId: string, envId: string, data: any) {
    const id = getEnvironmentId(userId, envId);
    await setDoc(doc(db, "environments", id), {
      ...data,
      userId,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  },

  async deleteEnvironment(userId: string, envId: string) {
    const id = getEnvironmentId(userId, envId);
    await deleteDoc(doc(db, "environments", id));
  }
};
