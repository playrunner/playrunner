terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.11"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  project_services = toset([
    "artifactregistry.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
  ])

  artifact_repositories = {
    api = {
      repository_id = "api"
      description   = "Docker repository for Playrunner API images"
    }
    orchestrator = {
      repository_id = "orchestrator"
      description   = "Docker repository for Playrunner orchestrator images"
    }
    playwright_runner = {
      repository_id = "playwright-runner"
      description   = "Docker repository for Playwright runner images"
    }
  }

  api_environment_variables = merge(
    {
      GCP_PUBSUB_WORKFLOW_EVENTS_TOPIC = var.workflow_events_topic_name
    },
    var.api_environment_variables,
  )
}

resource "google_project_service" "services" {
  for_each = local.project_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "time_sleep" "wait_for_project_services" {
  create_duration = "30s"

  depends_on = [
    google_project_service.services,
  ]
}

resource "google_artifact_registry_repository" "repositories" {
  for_each = local.artifact_repositories

  project       = var.project_id
  location      = var.region
  repository_id = each.value.repository_id
  description   = each.value.description
  format        = "DOCKER"

  depends_on = [
    time_sleep.wait_for_project_services,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_pubsub_topic" "workflow_events" {
  project = var.project_id
  name    = var.workflow_events_topic_name

  depends_on = [
    time_sleep.wait_for_project_services,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = var.scheduler_service_account_id
  display_name = "Playrunner Cloud Scheduler"
  description  = "Used by Cloud Scheduler to call Playrunner schedule trigger endpoints with OIDC."

  depends_on = [
    time_sleep.wait_for_project_services,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_service_account_iam_member" "scheduler_service_account_users" {
  for_each = var.scheduler_service_account_users

  service_account_id = google_service_account.scheduler.name
  role               = "roles/iam.serviceAccountUser"
  member             = each.value
}

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = var.api_service_name
  location = var.region
  ingress  = var.api_ingress

  template {
    scaling {
      min_instance_count = var.api_min_instance_count
      max_instance_count = var.api_max_instance_count
    }

    containers {
      name  = "api"
      image = var.api_bootstrap_image_uri

      ports {
        container_port = var.api_container_port
      }

      resources {
        cpu_idle          = var.api_cpu_idle
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = toset(keys(nonsensitive(local.api_environment_variables)))

        content {
          name  = env.value
          value = local.api_environment_variables[env.value]
        }
      }
    }
  }

  depends_on = [
    google_artifact_registry_repository.repositories,
    time_sleep.wait_for_project_services,
  ]

  lifecycle {
    create_before_destroy = true
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }
}

resource "time_sleep" "wait_for_api_service_iam" {
  create_duration = "30s"

  depends_on = [
    google_cloud_run_v2_service.api,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "api_public_invoker" {
  count = var.api_allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [
    time_sleep.wait_for_api_service_iam,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "api_scheduler_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"

  depends_on = [
    time_sleep.wait_for_api_service_iam,
  ]
}

resource "google_artifact_registry_repository_iam_member" "repo_reader" {
  for_each = google_artifact_registry_repository.repositories

  project    = each.value.project
  location   = each.value.location
  repository = each.value.name
  role       = "roles/artifactregistry.reader"
  member     = "allUsers"
}
