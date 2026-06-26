terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  project_services = toset([
    "pubsub.googleapis.com",
  ])

  artifact_repositories = {
    orchestrator = {
      repository_id = "orchestrator"
      description   = "Docker repository for Playrunner orchestrator images"
    }
    playwright_runner = {
      repository_id = "playwright-runner"
      description   = "Docker repository for Playwright runner images"
    }
  }
}

resource "google_project_service" "services" {
  for_each = local.project_services

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "repositories" {
  for_each = local.artifact_repositories

  location      = var.region
  repository_id = each.value.repository_id
  description   = each.value.description
  format        = "DOCKER"
}

resource "google_pubsub_topic" "workflow_events" {
  name = var.workflow_events_topic_name

  depends_on = [
    google_project_service.services,
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
